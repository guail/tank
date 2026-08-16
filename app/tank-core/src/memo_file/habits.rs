//! 习惯追踪模块: `habits` + `habit_checkins` 表 (全局, 存于 index.db)。
//!
//! 提供 CRUD、打卡切换、连续记录 (streak) 与最近 7 天视图计算。
//! 习惯是独立于笔记本的全局概念, 因此不绑定 notebook_id, 直接落在共享的
//! `index.db` 里, 多笔记本之间自然共享。

use chrono::{Duration, Local, NaiveDate};
use nanoid::nanoid;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use super::MemoFile;

fn to_io(e: rusqlite::Error) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Habit {
    pub id: String,
    pub name: String,
    pub description: String,
    pub emoji: String,
    pub color: String,
    /// `daily` | `weekly` | `custom`
    pub frequency: String,
    pub target_per_week: i64,
    pub created_at: i64,
    pub archived: bool,
    pub position: i64,
    /// 每日提醒时间 "HH:MM", 空字符串表示不提醒
    pub reminder_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitCheckin {
    pub habit_id: String,
    pub checkin_date: String,
    pub created_at: i64,
    pub note: String,
}

/// 列表返回: 习惯本体 + 实时统计。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitWithStats {
    pub habit: Habit,
    /// 当前连续天数 (今天未打卡时从昨天起算, 当天不算断签)
    pub streak: i64,
    pub best_streak: i64,
    pub total_checkins: i64,
    pub checked_today: bool,
    /// 最近 7 天日期 (含今天), 升序
    pub last_7_days: Vec<String>,
    /// 最近 7 天中已打卡的日期
    pub checked_dates: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitInput {
    pub name: String,
    pub description: Option<String>,
    pub emoji: Option<String>,
    pub color: Option<String>,
    pub frequency: Option<String>,
    pub target_per_week: Option<i64>,
    pub reminder_time: Option<String>,
}

fn today_naive() -> NaiveDate {
    Local::now().date_naive()
}

fn date_str(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

fn load_checkin_dates(conn: &Connection, habit_id: &str) -> std::io::Result<HashSet<String>> {
    let mut stmt = conn
        .prepare("SELECT checkin_date FROM habit_checkins WHERE habit_id = ?1")
        .map_err(to_io)?;
    let rows = stmt
        .query_map(params![habit_id], |row| row.get::<_, String>(0))
        .map_err(to_io)?;
    let mut set = HashSet::new();
    for r in rows {
        set.insert(r.map_err(to_io)?);
    }
    Ok(set)
}

/// 当前连续天数: 今天打卡则含今天; 否则从昨天起算 (当天未打卡不视为断签)。
fn compute_streak(dates: &HashSet<String>) -> i64 {
    let today = today_naive();
    let today_s = date_str(today);
    let mut cursor = today;
    if !dates.contains(&today_s) {
        cursor = today - Duration::days(1);
    }
    let mut streak = 0i64;
    loop {
        let s = date_str(cursor);
        if dates.contains(&s) {
            streak += 1;
            cursor -= Duration::days(1);
        } else {
            break;
        }
    }
    streak
}

fn compute_best_streak(dates: &HashSet<String>) -> i64 {
    let mut sorted: Vec<NaiveDate> = dates.iter().filter_map(|s| parse_date(s)).collect();
    sorted.sort();
    let mut best = 0i64;
    let mut cur = 0i64;
    let mut prev: Option<NaiveDate> = None;
    for d in sorted {
        match prev {
            Some(p) if d == p + Duration::days(1) => cur += 1,
            _ => cur = 1,
        }
        best = best.max(cur);
        prev = Some(d);
    }
    best
}

fn build_with_stats(habit: Habit, dates: &HashSet<String>) -> HabitWithStats {
    let today_s = date_str(today_naive());
    let streak = compute_streak(dates);
    let best_streak = compute_best_streak(dates);
    let total = dates.len() as i64;
    let mut last_7_days = Vec::new();
    let mut checked_dates = Vec::new();
    let today = today_naive();
    for i in (0..7).rev() {
        let s = date_str(today - Duration::days(i));
        last_7_days.push(s.clone());
        if dates.contains(&s) {
            checked_dates.push(s);
        }
    }
    HabitWithStats {
        habit,
        streak,
        best_streak,
        total_checkins: total,
        checked_today: dates.contains(&today_s),
        last_7_days,
        checked_dates,
    }
}

fn row_to_habit(row: &rusqlite::Row) -> Result<Habit, rusqlite::Error> {
    Ok(Habit {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        emoji: row.get(3)?,
        color: row.get(4)?,
        frequency: row.get(5)?,
        target_per_week: row.get(6)?,
        created_at: row.get(7)?,
        archived: row.get::<_, i64>(8)? != 0,
        position: row.get(9)?,
        reminder_time: row.get(10)?,
    })
}

impl MemoFile {
    pub fn list_habits(&self, include_archived: bool) -> std::io::Result<Vec<HabitWithStats>> {
        let conn = self.open_memo_index_db()?;
        let mut stmt = conn
            .prepare(
                "SELECT id,name,description,emoji,color,frequency,target_per_week,created_at,archived,position,reminder_time \
                 FROM habits WHERE (?1=1 OR archived=0) ORDER BY position ASC, created_at ASC",
            )
            .map_err(to_io)?;
        let rows = stmt
            .query_map(params![include_archived as i64], row_to_habit)
            .map_err(to_io)?;
        let habits: Vec<Habit> = rows
            .map(|r| r.map_err(to_io))
            .collect::<Result<Vec<_>, _>>()?;

        let mut out = Vec::with_capacity(habits.len());
        for h in habits {
            let dates = load_checkin_dates(&conn, &h.id)?;
            out.push(build_with_stats(h, &dates));
        }
        Ok(out)
    }

    pub fn create_habit(&self, input: HabitInput) -> std::io::Result<Habit> {
        let conn = self.open_memo_index_db()?;
        let id = format!("hb_{}", nanoid!(12));
        let now = chrono::Utc::now().timestamp_millis();
        let max_pos: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) FROM habits",
                [],
                |row| row.get(0),
            )
            .map_err(to_io)?;
        let position = max_pos + 1;
        let habit = Habit {
            id,
            name: input.name,
            description: input.description.unwrap_or_default(),
            emoji: input.emoji.unwrap_or_else(|| "🔥".to_string()),
            color: input.color.unwrap_or_else(|| "#f97316".to_string()),
            frequency: input.frequency.unwrap_or_else(|| "daily".to_string()),
            target_per_week: input.target_per_week.unwrap_or(7),
            created_at: now,
            archived: false,
            position,
            reminder_time: input.reminder_time.clone().unwrap_or_default(),
        };
        conn.execute(
            "INSERT INTO habits \
             (id,name,description,emoji,color,frequency,target_per_week,created_at,archived,position,reminder_time) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,?9,?10)",
            params![
                habit.id,
                habit.name,
                habit.description,
                habit.emoji,
                habit.color,
                habit.frequency,
                habit.target_per_week,
                habit.created_at,
                habit.position,
                habit.reminder_time
            ],
        )
        .map_err(to_io)?;
        Ok(habit)
    }

    pub fn update_habit(&self, habit: Habit) -> std::io::Result<Habit> {
        let conn = self.open_memo_index_db()?;
        conn.execute(
            "UPDATE habits SET name=?2,description=?3,emoji=?4,color=?5,frequency=?6, \
             target_per_week=?7,archived=?8,position=?9,reminder_time=?10 WHERE id=?1",
            params![
                habit.id,
                habit.name,
                habit.description,
                habit.emoji,
                habit.color,
                habit.frequency,
                habit.target_per_week,
                habit.archived as i64,
                habit.position,
                habit.reminder_time
            ],
        )
        .map_err(to_io)?;
        Ok(habit)
    }

    pub fn delete_habit(&self, id: &str) -> std::io::Result<()> {
        let conn = self.open_memo_index_db()?;
        conn.execute("DELETE FROM habits WHERE id=?1", params![id])
            .map_err(to_io)?;
        Ok(())
    }

    /// 切换某天打卡状态 (默认今天)。返回更新后的统计。
    pub fn toggle_habit_checkin(
        &self,
        id: &str,
        date: Option<String>,
    ) -> std::io::Result<HabitWithStats> {
        let conn = self.open_memo_index_db()?;
        let date = date.unwrap_or_else(|| date_str(today_naive()));
        let exists: Option<String> = conn
            .query_row(
                "SELECT checkin_date FROM habit_checkins WHERE habit_id=?1 AND checkin_date=?2",
                params![id, date],
                |row| row.get(0),
            )
            .optional()
            .map_err(to_io)?;
        if exists.is_some() {
            conn.execute(
                "DELETE FROM habit_checkins WHERE habit_id=?1 AND checkin_date=?2",
                params![id, date],
            )
            .map_err(to_io)?;
        } else {
            conn.execute(
                "INSERT INTO habit_checkins (habit_id,checkin_date,created_at,note) VALUES (?1,?2,?3,'')",
                params![id, date, chrono::Utc::now().timestamp_millis()],
            )
            .map_err(to_io)?;
        }
        let habit = conn
            .query_row(
                "SELECT id,name,description,emoji,color,frequency,target_per_week,created_at,archived,position,reminder_time \
                 FROM habits WHERE id=?1",
                params![id],
                row_to_habit,
            )
            .map_err(to_io)?;
        let dates = load_checkin_dates(&conn, id)?;
        Ok(build_with_stats(habit, &dates))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn best_streak_counts_longest_consecutive_run() {
        let dates: HashSet<String> = [
            "2026-08-01",
            "2026-08-02",
            "2026-08-03",
            "2026-08-10",
            "2026-08-11",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(compute_best_streak(&dates), 3);
    }

    #[test]
    fn best_streak_single_day_is_one() {
        let dates: HashSet<String> = ["2026-08-01"].iter().map(|s| s.to_string()).collect();
        assert_eq!(compute_best_streak(&dates), 1);
    }

    #[test]
    fn best_streak_empty_is_zero() {
        let dates: HashSet<String> = HashSet::new();
        assert_eq!(compute_best_streak(&dates), 0);
    }
}
