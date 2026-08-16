// ==================== Trash / Recycle Bin ====================

use tauri::State;

use tank_core::MemoService;

use crate::app::state::AppState;
use crate::lock_utils::read_lock;

#[tauri::command]
pub fn list_trashed_memos(state: State<AppState>) -> Vec<tank_core::memo_file::TrashedMemo> {
    MemoService::new(&read_lock(&state.memo_file, "memo_file"))
        .list_trashed_memos()
        .unwrap_or_default()
}

#[tauri::command]
pub fn restore_trashed_memo(id: String, state: State<AppState>) -> bool {
    MemoService::new(&read_lock(&state.memo_file, "memo_file"))
        .restore_trashed_memo(&id)
        .unwrap_or(false)
}

#[tauri::command]
pub fn permanently_delete_trashed_memo(id: String, state: State<AppState>) -> bool {
    MemoService::new(&read_lock(&state.memo_file, "memo_file"))
        .permanently_delete_trashed_memo(&id)
        .unwrap_or(false)
}

#[tauri::command]
pub fn empty_trash(state: State<AppState>) -> bool {
    MemoService::new(&read_lock(&state.memo_file, "memo_file"))
        .empty_trash()
        .is_ok()
}
