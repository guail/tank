//! 提醒引擎的调度核心 (FlowState 融合, 纯逻辑, 不依赖平台/通知库)。
//!
//! `reminder` 字段存的是自由文本 (如 `09:00`、`fri 09:00`、`周五 09:00`),
//! 本模块负责把它解析成"最近一次应提醒时刻", 并判定当前是否处于应提醒窗口。
//!
//! 设计要点:
//! - 一个 "HH:MM" 提醒视为**每天**该时刻; 带星期前缀则视为**每周**该星期该时刻。
//! - 判定 `is_reminder_due`: 取"最近一次 ≤ now 的应提醒时刻" `prev`, 若
//!   `now - prev <= REMINDER_GRACE_MINUTES` 则视为到点 (避免循环每 tick 重复触发,
//!   真正的"已通知"去重由桌面端后台循环用内存集合负责)。
//! - 全部纯函数, 便于单测; 时间以 `DateTime<Local>` 传入。

use chrono::{DateTime, Datelike, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeDelta, TimeZone, Weekday};
use once_cell::sync::Lazy;
use regex::Regex;

use super::types::MemoTodoEntry;

/// 到点后的宽限窗口 (分钟): 超过此窗口视为"错过", 不再算 due。
const REMINDER_GRACE_MINUTES: i64 = 60;

static TIME_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(\d{1,2}):(\d{2})(?::(\d{2}))?").unwrap());

/// 数字星期 (1-7, 1=周一): 仅当紧跟在 "周"/"星期" 之后才识别, 否则时间串 "13:34"
/// 的首位 '1' 会被误判为周一, 导致整条提醒的日期被错算到上周一。
static WD_DIGIT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?:周|星期)(\d)").unwrap());

/// 从文本中提取星期 (中文 / 英文缩写或全拼 / 数字 1-7)。返回 (Option<Weekday>, 原文)。
fn find_weekday(text: &str) -> Option<Weekday> {
    let lower = text.to_lowercase();
    // 中文
    const CN: [(&str, Weekday); 15] = [
        ("周一", Weekday::Mon),
        ("星期一", Weekday::Mon),
        ("周二", Weekday::Tue),
        ("星期二", Weekday::Tue),
        ("周三", Weekday::Wed),
        ("星期三", Weekday::Wed),
        ("周四", Weekday::Thu),
        ("星期四", Weekday::Thu),
        ("周五", Weekday::Fri),
        ("星期五", Weekday::Fri),
        ("周六", Weekday::Sat),
        ("星期六", Weekday::Sat),
        ("周日", Weekday::Sun),
        ("星期日", Weekday::Sun),
        ("周天", Weekday::Sun),
    ];
    for (token, wd) in CN {
        if lower.contains(token) {
            return Some(wd);
        }
    }
    // 英文
    const EN: [(&str, Weekday); 7] = [
        ("mon", Weekday::Mon),
        ("tue", Weekday::Tue),
        ("wed", Weekday::Wed),
        ("thu", Weekday::Thu),
        ("fri", Weekday::Fri),
        ("sat", Weekday::Sat),
        ("sun", Weekday::Sun),
    ];
    for (token, wd) in EN {
        if lower.contains(token) {
            return Some(wd);
        }
    }
    // 数字 1-7 (1=周一): 仅当紧跟在 "周"/"星期" 之后才识别, 避免把时间串 "13:34" 误判。
    if let Some(caps) = WD_DIGIT_RE.captures(&lower) {
        if let Some(n) = caps.get(1).unwrap().as_str().parse::<u32>().ok() {
            if (1..=7).contains(&n) {
                // 1=Mon .. 7=Sun
                const DIGIT_TO_WD: [Weekday; 7] = [
                    Weekday::Mon,
                    Weekday::Tue,
                    Weekday::Wed,
                    Weekday::Thu,
                    Weekday::Fri,
                    Weekday::Sat,
                    Weekday::Sun,
                ];
                return Some(DIGIT_TO_WD[(n - 1) as usize]);
            }
        }
    }
    None
}

/// 取"不晚于 `d` 且星期为 `wd` 的最近日期" (含 `d` 当天)。
fn most_recent_weekday_on_or_before(d: NaiveDate, wd: Weekday) -> NaiveDate {
    let mut cur = d;
    for _ in 0..7 {
        if cur.weekday() == wd {
            return cur;
        }
        cur = cur - TimeDelta::days(1);
    }
    cur
}

/// 解析提醒文本为"最近一次 ≤ now 的应提醒时刻"。解析不出返回 None。
pub fn parse_reminder_prev(text: &str, now: DateTime<Local>) -> Option<DateTime<Local>> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let cap = TIME_RE.captures(text)?;
    let h: u32 = cap.get(1)?.as_str().parse().ok()?;
    let m: u32 = cap.get(2)?.as_str().parse().ok()?;
    let s: u32 = cap
        .get(3)
        .map(|x| x.as_str().parse::<u32>().ok())
        .flatten()
        .unwrap_or(0);
    let time = NaiveTime::from_hms_opt(h, m, s)?;

    let today = now.date_naive();
    let date = match find_weekday(text) {
        None => today,
        Some(wd) => most_recent_weekday_on_or_before(today, wd),
    };
    let naive = NaiveDateTime::new(date, time);
    let cand = Local.from_local_datetime(&naive).single()?;
    if cand <= now {
        Some(cand)
    } else {
        let back = if find_weekday(text).is_some() {
            TimeDelta::days(7)
        } else {
            TimeDelta::days(1)
        };
        let prev_naive = NaiveDateTime::new(date - back, time);
        Local.from_local_datetime(&prev_naive).single()
    }
}

/// 当前是否处于应提醒窗口 (见 [`REMINDER_GRACE_MINUTES`])。
pub fn is_reminder_due(text: &str, now: DateTime<Local>) -> bool {
    match parse_reminder_prev(text, now) {
        Some(prev) => (now - prev).num_minutes() <= REMINDER_GRACE_MINUTES,
        None => false,
    }
}

/// 从一组任务中筛出当前应提醒且未完成者。
pub fn due_reminders(todos: &[MemoTodoEntry], now: DateTime<Local>) -> Vec<MemoTodoEntry> {
    todos
        .iter()
        .filter(|t| {
            t.status != "completed"
                && !t.reminder.trim().is_empty()
                && is_reminder_due(&t.reminder, now)
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn ldt(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Local> {
        Local
            .from_local_datetime(
                &NaiveDate::from_ymd_opt(y, mo, d)
                    .unwrap()
                    .and_hms_opt(h, mi, 0)
                    .unwrap(),
            )
            .single()
            .unwrap()
    }

    #[test]
    fn daily_reminder_due_window() {
        // 2026-08-14 是周五
        let now = ldt(2026, 8, 14, 9, 30); // 09:30, 在 09:00 后 30 分钟内 -> due
        assert!(is_reminder_due("09:00", now));
        assert!(is_reminder_due("周五 09:00", now));
        assert!(is_reminder_due("fri 09:00", now));

        let before = ldt(2026, 8, 14, 8, 0); // 09:00 之前 -> 未到
        assert!(!is_reminder_due("09:00", before));

        let after = ldt(2026, 8, 14, 10, 30); // 超过 60 分钟宽限 -> 不再 due
        assert!(!is_reminder_due("09:00", after));
    }

    #[test]
    fn weekly_reminder_only_on_its_weekday() {
        let fri = ldt(2026, 8, 14, 9, 30); // 周五
        assert!(is_reminder_due("fri 09:00", fri));
        let thu = ldt(2026, 8, 13, 9, 30); // 周四: 最近周五是一周前 -> 远超宽限
        assert!(!is_reminder_due("fri 09:00", thu));
        let sat = ldt(2026, 8, 15, 9, 30); // 周六: 最近周五是一天前(>60min) -> 不 due
        assert!(!is_reminder_due("fri 09:00", sat));
    }

    #[test]
    fn unparseable_is_not_due() {
        assert!(!is_reminder_due("", ldt(2026, 8, 14, 9, 30)));
        assert!(!is_reminder_due("没有时间", ldt(2026, 8, 14, 9, 30)));
        assert!(!is_reminder_due("买牛奶", ldt(2026, 8, 14, 9, 30)));
    }

    #[test]
    fn time_with_leading_digit_is_daily_not_weekly() {
        // 回归: "13:34" 首位 '1' 绝不能当成周一, 否则日期被错算到上周一 (08-10)。
        // 2026-08-14 是周五, 13:33 时 13:34 还没到 -> prev 应为昨天 08-13 (周四)。
        let now = ldt(2026, 8, 14, 13, 33);
        let prev = parse_reminder_prev("13:34", now).unwrap();
        assert_ne!(
            prev.date_naive(),
            NaiveDate::from_ymd_opt(2026, 8, 10).unwrap(),
            "时间首位数字被误判为星期, 日期错算到上周一"
        );
        assert_eq!(prev.weekday(), Weekday::Thu);
    }

    #[test]
    fn due_reminders_filters_completed_and_empty() {
        let now = ldt(2026, 8, 14, 9, 30);
        let todos = vec![
            MemoTodoEntry {
                content: "到期任务".into(),
                status: "pending".into(),
                memo_id: "m1".into(),
                priority: String::new(),
                time_range: String::new(),
                owner: String::new(),
                assignee: String::new(),
                disposition: String::new(),
                waiting_for: String::new(),
                created_at: 0,
                updated_at: 0,
                reminder: "09:00".into(),
                category_id: String::new(),
            },
            MemoTodoEntry {
                content: "已完成".into(),
                status: "completed".into(),
                memo_id: "m2".into(),
                priority: String::new(),
                time_range: String::new(),
                owner: String::new(),
                assignee: String::new(),
                disposition: String::new(),
                waiting_for: String::new(),
                created_at: 0,
                updated_at: 0,
                reminder: "09:00".into(),
                category_id: String::new(),
            },
            MemoTodoEntry {
                content: "无提醒".into(),
                status: "pending".into(),
                memo_id: "m3".into(),
                priority: String::new(),
                time_range: String::new(),
                owner: String::new(),
                assignee: String::new(),
                disposition: String::new(),
                waiting_for: String::new(),
                created_at: 0,
                updated_at: 0,
                reminder: String::new(),
                category_id: String::new(),
            },
        ];
        let due = due_reminders(&todos, now);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].memo_id, "m1");
    }
}
