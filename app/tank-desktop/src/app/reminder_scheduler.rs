//! 提醒引擎后台调度器 (FlowState 融合)。
//!
//! 周期性扫描全部任务的 `reminder` 字段, 把已到期且尚未重复通知过的任务
//! 通过系统通知弹出。纯调度 + 去重放在桌面端; "文本 -> 最近应提醒时刻" 的
//! 解析核心在 `tank_core::memo_file::reminder`。
//!
//! 去重策略: 每条任务以 `memo_id::reminder` 为键, 记录上次已通知的"应提醒
//! 时刻"(`parse_reminder_prev` 给出的 ≤ now 的最近一次)。只有当本次解析出的
//! 应提醒时刻与该键上次记录不同 (即跨入一个新的提醒周期) 时才再次弹窗,
//! 这样在 60 分钟宽限窗口内每 30 秒轮询也不会重复打扰。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Local, Utc};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use tank_core::memo_file::reminder::{due_reminders, is_reminder_due, parse_reminder_prev};
use tank_core::memo_file::MemoFile;

/// 扫描间隔 (秒)。提醒解析带 60 分钟宽限窗口, 30s 轮询足以在窗口内至少命中一次。
const REMINDER_POLL_SECS: u64 = 30;

/// memo_id::reminder -> 上次已通知的应提醒时刻。
/// 用 `DateTime<Utc>` 而非 `DateTime<Local>` —— `DateTime<Local>` 在共享
/// `Mutex` 里不是 `Send`, 会让承载它的 async future 无法跨线程 (`spawn` 要求
/// `Send`); `DateTime<Utc>` 无条件 `Send`, 等价时间点, 无副作用。
type NotifiedMap = Arc<Mutex<HashMap<String, DateTime<Utc>>>>;

fn notify_key(memo_id: &str, reminder: &str) -> String {
    format!("{}::{}", memo_id, reminder)
}

/// 启动提醒后台循环 (fire-and-forget tokio 任务)。
pub fn spawn_reminder_scheduler(
    app_handle: AppHandle,
    memo_file: Arc<std::sync::RwLock<MemoFile>>,
) {
    let notified: NotifiedMap = Arc::new(Mutex::new(HashMap::new()));
    tauri::async_runtime::spawn(reminder_loop(app_handle, memo_file, notified));
}

/// 单次扫描: 读全部任务 -> 筛到期 -> 弹通知。内部没有任何 `.await`,
/// 因此 `map` 锁不会跨过挂起点 (否则 future 不满足 `Send`), 调用方负责在
/// 两次 `scan_once` 之间 `sleep`。
async fn scan_once(
    app_handle: &AppHandle,
    memo_file: &Arc<std::sync::RwLock<MemoFile>>,
    notified: &NotifiedMap,
    now: DateTime<Local>,
) {
    // ---- 任务提醒 ----
    let todos = match memo_file.read() {
        Ok(guard) => match guard.read_all_todo_metadata_entries() {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!("[reminder] failed to read todos: {e}");
                Vec::new()
            }
        },
        Err(poisoned) => {
            tracing::warn!("[reminder] memo_file read lock poisoned: {poisoned}");
            Vec::new()
        }
    };

    let due = due_reminders(&todos, now);
    if due.is_empty() {
        // 诊断: 有待提醒字段但未命中窗口时, 把解析结果打出来便于排查
        let candidates: Vec<_> = todos
            .iter()
            .filter(|t| !t.reminder.trim().is_empty() && t.status != "completed")
            .collect();
        if !candidates.is_empty() {
            for t in &candidates {
                match parse_reminder_prev(&t.reminder, now) {
                    Some(prev) => {
                        let delta = (now - prev).num_minutes();
                        tracing::info!(
                            "[reminder] pending content='{}' reminder='{}' prev={} delta={}min (due if <=60)",
                            t.content,
                            t.reminder,
                            prev.format("%m-%d %H:%M"),
                            delta
                        );
                    }
                    None => {
                        tracing::info!(
                            "[reminder] unparseable reminder content='{}' reminder='{}'",
                            t.content,
                            t.reminder
                        );
                    }
                }
            }
        }
    }

    // ---- 习惯提醒: 每天固定时间, 当天未打卡则弹通知 ----
    let habits = match memo_file.read() {
        Ok(guard) => match guard.list_habits(false) {
            Ok(h) => h,
            Err(e) => {
                tracing::warn!("[reminder] failed to read habits: {e}");
                Vec::new()
            }
        },
        Err(poisoned) => {
            tracing::warn!("[reminder] memo_file read lock poisoned: {poisoned}");
            Vec::new()
        }
    };

    let mut map = notified.lock().unwrap();

    // 任务
    for todo in due {
        let key = notify_key(&todo.memo_id, &todo.reminder);
        let prev = match parse_reminder_prev(&todo.reminder, now) {
            Some(p) => p,
            None => continue,
        };
        let prev_utc = prev.to_utc();
        let already = map.get(&key).map(|last| *last == prev_utc).unwrap_or(false);
        if already {
            continue;
        }
        map.insert(key, prev_utc);

        let body = todo.content.clone();
        if let Err(e) = app_handle
            .notification()
            .builder()
            .title("TANK 提醒")
            .body(&body)
            .show()
        {
            tracing::warn!("[reminder] failed to show notification: {e}");
        } else {
            tracing::info!("[reminder] notified: {}", todo.content);
        }
    }

    // 习惯
    for hw in &habits {
        let rt = hw.habit.reminder_time.trim();
        if rt.is_empty() || hw.checked_today {
            continue;
        }
        if !is_reminder_due(rt, now) {
            continue;
        }
        let key = format!("habit::{}::{}", hw.habit.id, rt);
        let prev = match parse_reminder_prev(rt, now) {
            Some(p) => p,
            None => continue,
        };
        let prev_utc = prev.to_utc();
        let already = map.get(&key).map(|last| *last == prev_utc).unwrap_or(false);
        if already {
            continue;
        }
        map.insert(key, prev_utc);
        let body = format!("「{}」该打卡啦", hw.habit.name);
        if let Err(e) = app_handle
            .notification()
            .builder()
            .title("TANK 习惯提醒")
            .body(&body)
            .show()
        {
            tracing::warn!("[reminder] failed to show habit notification: {e}");
        } else {
            tracing::info!("[reminder] notified habit: {}", hw.habit.name);
        }
    }
}

async fn reminder_loop(
    app_handle: AppHandle,
    memo_file: Arc<std::sync::RwLock<MemoFile>>,
    notified: NotifiedMap,
) {
    use tokio::time::{sleep, Duration};
    tracing::info!(
        "[reminder] scheduler started, polling every {}s (first scan runs now)",
        REMINDER_POLL_SECS
    );
    // 启动即扫一次, 便于确认调度器确实在跑、首条待提醒也能尽快弹出。
    scan_once(&app_handle, &memo_file, &notified, Local::now()).await;
    loop {
        sleep(Duration::from_secs(REMINDER_POLL_SECS)).await;
        scan_once(&app_handle, &memo_file, &notified, Local::now()).await;
    }
}
