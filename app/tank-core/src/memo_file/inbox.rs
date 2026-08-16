//! 收件箱状态机 + 每周回顾扫描器 (FlowState 融合, 纯逻辑, 不依赖平台)。
#![allow(dead_code)] // 纯领域模块, 调用方 (UI/提醒引擎) 在后续任务接线
//!
//! ## 收件箱状态机
//!
//! 每条任务在收件箱里必须被"澄清"为四种处置之一 (对应 FlowState 的
//! Inbox 强制决策):
//! - `actionable` 可行动 — 现在就能做
//! - `waiting` 等待他人 — 卡在别人那 (记 `waiting_for`)
//! - `someday` 将来也许 — 暂不行动, 留作储备
//! - (已完成 — 由 `MemoTodoEntry.status == "completed"` 表示, 不入此列)
//!
//! `disposition` 默认空串, 解析器视其为 `actionable`。将来堆积 / 等待太久
//! 等"亚健康"判定见 [`weekly_review`]。
//!
//! ## 每周回顾扫描器
//!
//! [`weekly_review`] 扫描一组任务 (DB 行), 自动归类出四类需要清理的任务:
//! 1. 过期 — 有截止时间且已过期, 仍未完成
//! 2. 长期未动 — 未完成且 `updated_at` 早于 `stale_after_days` 天
//! 3. 等待太久 — `disposition == waiting` 且早于 `waiting_too_long_days` 天
//! 4. 将来堆积 — `disposition == someday` 且早于 `someday_pileup_days` 天
//!
//! 全部为纯函数, 便于单测; 时间以毫秒时间戳传入 (`now_ms`)。

use crate::memo_file::types::MemoTodoEntry;

/// 收件箱处置类别。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Disposition {
    /// 可行动 (默认)。
    Actionable,
    /// 等待他人 (`waiting_for` 记录等谁)。
    Waiting,
    /// 将来也许。
    Someday,
}

impl Disposition {
    /// 从 `disposition` 字符串解析, 空串视作 `Actionable`。
    pub fn from_str(value: &str) -> Disposition {
        match value.trim().to_ascii_lowercase().as_str() {
            "waiting" => Disposition::Waiting,
            "someday" => Disposition::Someday,
            _ => Disposition::Actionable,
        }
    }
}

/// 单条任务在收件箱分类中的归属。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InboxBucket {
    /// 已完成, 移出收件箱。
    Completed,
    /// 可行动。
    Actionable,
    /// 等待他人 (携带等谁)。
    Waiting(String),
    /// 将来也许。
    Someday,
}

/// 将单条任务归入收件箱某一桶。
pub fn classify_todo(todo: &MemoTodoEntry) -> InboxBucket {
    if todo.status == "completed" {
        return InboxBucket::Completed;
    }
    match Disposition::from_str(&todo.disposition) {
        Disposition::Waiting => InboxBucket::Waiting(todo.waiting_for.clone()),
        Disposition::Someday => InboxBucket::Someday,
        Disposition::Actionable => InboxBucket::Actionable,
    }
}

/// 每周回顾的阈值配置 (天数)。
#[derive(Debug, Clone, Copy)]
pub struct ReviewThresholds {
    /// 未完成且超过该天数未更新 → 长期未动。
    pub stale_after_days: i64,
    /// 等待他人且超过该天数 → 等待太久。
    pub waiting_too_long_days: i64,
    /// 将来也许且超过该天数 → 将来堆积。
    pub someday_pileup_days: i64,
}

impl Default for ReviewThresholds {
    fn default() -> Self {
        Self {
            stale_after_days: 30,
            waiting_too_long_days: 14,
            someday_pileup_days: 60,
        }
    }
}

/// 每周回顾扫描出的四类亚健康任务 (持有 DB 行, 方便前端跳转对应笔记)。
#[derive(Debug, Clone, Default)]
pub struct ReviewReport {
    /// 过期: 有截止且已过期, 未完成。
    pub overdue: Vec<MemoTodoEntry>,
    /// 长期未动: 未完成且久未更新。
    pub stale: Vec<MemoTodoEntry>,
    /// 等待太久: 等待他人且过久。
    pub waiting_too_long: Vec<MemoTodoEntry>,
    /// 将来堆积: 将来也许且堆积过久。
    pub someday_pileup: Vec<MemoTodoEntry>,
}

/// 判断任务的 `time_range` 是否表示"已过期"。
///
/// 支持 `YYYY-MM-DD` / `YYYY-MM-DDTHH:MM` / `YYYY-MM-DD HH:MM` 三种前缀;
/// 取前 19 个字符做解析, 解析不出则视为不过期 (不误杀)。
fn is_overdue(todo: &MemoTodoEntry, now_ms: i64) -> bool {
    if todo.status == "completed" {
        return false;
    }
    let raw = todo.time_range.trim();
    if raw.is_empty() {
        return false;
    }
    let candidate = &raw[..raw.len().min(19)];
    let parsed = chrono::NaiveDateTime::parse_from_str(candidate, "%Y-%m-%d %H:%M")
        .or_else(|_| {
            chrono::NaiveDate::parse_from_str(candidate, "%Y-%m-%d")
                .map(|d| d.and_hms_opt(0, 0, 0).unwrap())
        });
    match parsed {
        Ok(dt) => dt.and_utc().timestamp_millis() < now_ms,
        Err(_) => false,
    }
}

/// 对一组任务执行每周回顾扫描。
///
/// `now_ms` 为当前毫秒时间戳。返回四类亚健康任务的归类报告。
/// 同一任务可能同时命中多类 (如既过期又长期未动), 会分别出现在对应列表里。
pub fn weekly_review(
    todos: &[MemoTodoEntry],
    now_ms: i64,
    thresholds: ReviewThresholds,
) -> ReviewReport {
    let day_ms = 86_400_000i64;
    let stale_cutoff = now_ms - thresholds.stale_after_days * day_ms;
    let waiting_cutoff = now_ms - thresholds.waiting_too_long_days * day_ms;
    let someday_cutoff = now_ms - thresholds.someday_pileup_days * day_ms;

    let mut report = ReviewReport::default();
    for todo in todos {
        if todo.status == "completed" {
            continue;
        }
        if is_overdue(todo, now_ms) {
            report.overdue.push(todo.clone());
        }
        if todo.updated_at > 0 && todo.updated_at < stale_cutoff {
            report.stale.push(todo.clone());
        }
        match Disposition::from_str(&todo.disposition) {
            Disposition::Waiting if todo.updated_at > 0 && todo.updated_at < waiting_cutoff => {
                report.waiting_too_long.push(todo.clone());
            }
            Disposition::Someday if todo.updated_at > 0 && todo.updated_at < someday_cutoff => {
                report.someday_pileup.push(todo.clone());
            }
            _ => {}
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memo_file::types::MemoTodoEntry;

    fn todo(content: &str) -> MemoTodoEntry {
        MemoTodoEntry {
            content: content.to_string(),
            status: "pending".to_string(),
            memo_id: "memo-1".to_string(),
            priority: String::new(),
            time_range: String::new(),
            owner: String::new(),
            assignee: String::new(),
            disposition: String::new(),
            waiting_for: String::new(),
            reminder: String::new(),
            category_id: String::new(),
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn classify_default_is_actionable() {
        assert_eq!(classify_todo(&todo("x")), InboxBucket::Actionable);
    }

    #[test]
    fn classify_completed_exits_inbox() {
        let mut t = todo("done");
        t.status = "completed".to_string();
        assert_eq!(classify_todo(&t), InboxBucket::Completed);
    }

    #[test]
    fn classify_waiting_captures_who() {
        let mut t = todo("blocked");
        t.disposition = "waiting".to_string();
        t.waiting_for = "Alice".to_string();
        assert_eq!(classify_todo(&t), InboxBucket::Waiting("Alice".to_string()));
    }

    #[test]
    fn classify_someday() {
        let mut t = todo("maybe");
        t.disposition = "someday".to_string();
        assert_eq!(classify_todo(&t), InboxBucket::Someday);
    }

    #[test]
    fn overdue_detects_past_due_date() {
        let mut t = todo("pay");
        t.time_range = "2020-01-01".to_string();
        let mut r = weekly_review(&[t], 1_600_000_000_000, ReviewThresholds::default());
        assert_eq!(r.overdue.len(), 1);
        // 没有截止时间的任务不应被误判过期
        let mut t2 = todo("no-due");
        r = weekly_review(&[t2.clone()], 1_600_000_000_000, ReviewThresholds::default());
        assert!(r.overdue.is_empty());
        // 未来日期不过期
        t2.time_range = "2999-01-01".to_string();
        r = weekly_review(&[t2], 1_600_000_000_000, ReviewThresholds::default());
        assert!(r.overdue.is_empty());
    }

    #[test]
    fn stale_and_waiting_and_someday_pileup() {
        let now = 1_600_000_000_000; // 2020-09-13
        let mut stale = todo("old");
        stale.updated_at = now - 40 * 86_400_000;

        let mut waiting = todo("wait");
        waiting.disposition = "waiting".to_string();
        waiting.updated_at = now - 20 * 86_400_000;

        let mut someday = todo("someday");
        someday.disposition = "someday".to_string();
        someday.updated_at = now - 70 * 86_400_000;

        let r = weekly_review(
            &[stale, waiting, someday],
            now,
            ReviewThresholds::default(),
        );
        // stale(40d) 与 someday(70d) 都满足"长期未动(>30d)" → 同落 stale 桶。
        assert_eq!(r.stale.len(), 2);
        assert_eq!(r.waiting_too_long.len(), 1);
        // someday(70d) 既满足"将来堆积(>60d)"也满足"长期未动", 故同时出现在两桶。
        assert_eq!(r.someday_pileup.len(), 1);
    }

    #[test]
    fn completed_tasks_excluded_from_review() {
        let mut t = todo("done");
        t.status = "completed".to_string();
        t.time_range = "2020-01-01".to_string();
        let r = weekly_review(&[t], 1_600_000_000_000, ReviewThresholds::default());
        assert!(r.overdue.is_empty());
        assert!(r.stale.is_empty());
    }
}
