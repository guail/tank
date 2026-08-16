//! 习惯追踪 IPC 命令 — 全局习惯 CRUD + 打卡切换。
//!
//! 习惯数据存于 `index.db` 的 `habits` / `habit_checkins` 表 (见
//! `tank_core::memo_file::habits`), 与笔记本无关, 多笔记本共享。
//!
//! 所有命令都声明为 `async` 并在线程池中执行 SQLite 操作, 避免同步命令
//! 阻塞 Tauri 主线程导致 UI "卡死"。

use std::sync::Arc;

use tauri::State;

use tank_core::memo_file::MemoFile;
use tank_core::memo_file::habits::{Habit, HabitInput, HabitWithStats};

use crate::app::state::AppState;
use crate::lock_utils::read_lock;

async fn run_blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, std::io::Error> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_habits(
    include_archived: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<HabitWithStats>, String> {
    let include_archived = include_archived.unwrap_or(false);
    let memo_file: Arc<std::sync::RwLock<MemoFile>> = state.memo_file.clone();
    run_blocking(move || read_lock(&memo_file, "memo_file").list_habits(include_archived))
        .await
}

#[tauri::command]
pub async fn create_habit(
    input: HabitInput,
    state: State<'_, AppState>,
) -> Result<Habit, String> {
    let memo_file: Arc<std::sync::RwLock<MemoFile>> = state.memo_file.clone();
    run_blocking(move || read_lock(&memo_file, "memo_file").create_habit(input)).await
}

#[tauri::command]
pub async fn update_habit(
    habit: Habit,
    state: State<'_, AppState>,
) -> Result<Habit, String> {
    let memo_file: Arc<std::sync::RwLock<MemoFile>> = state.memo_file.clone();
    run_blocking(move || read_lock(&memo_file, "memo_file").update_habit(habit)).await
}

#[tauri::command]
pub async fn delete_habit(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let memo_file: Arc<std::sync::RwLock<MemoFile>> = state.memo_file.clone();
    run_blocking(move || read_lock(&memo_file, "memo_file").delete_habit(&id)).await
}

#[tauri::command]
pub async fn toggle_habit_checkin(
    id: String,
    date: Option<String>,
    state: State<'_, AppState>,
) -> Result<HabitWithStats, String> {
    let memo_file: Arc<std::sync::RwLock<MemoFile>> = state.memo_file.clone();
    run_blocking(move || read_lock(&memo_file, "memo_file").toggle_habit_checkin(&id, date)).await
}
