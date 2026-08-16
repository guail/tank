// ==================== Backlinks ====================

use std::path::Path;

use tauri::State;

use crate::app::state::AppState;
use crate::lock_utils::read_lock;
use tank_core::MemoService;

use super::helpers::note_title;
use super::MemoBacklinkItem;

/// Replace serialized references to `memo_id` with a neutral marker so a
/// backlink snippet reads naturally instead of exposing raw link markup.
///
/// Matches both storage formats produced by the `noteReference` node:
///  - new: `[title](tank://memo/<id>)`
///  - old: `<note id="<id>" notebook="..." path="...">title</note>`
fn mask_references(body: &str, memo_id: &str) -> String {
  let new_pat = format!("tank://memo/{}", memo_id);
  let masked = body.replace(&new_pat, "◆");

  let old_open = format!("<note id=\"{}\"", memo_id);
  let mut out = String::with_capacity(masked.len());
  let mut rest = masked.as_str();
  while let Some(idx) = rest.find(&old_open) {
    out.push_str(&rest[..idx]);
    out.push('◆');
    let tail = &rest[idx..];
    if let Some(gt) = tail.find('>') {
      rest = &tail[gt + 1..];
    } else {
      rest = &tail[old_open.len()..];
    }
  }
  out.push_str(rest);
  out
}

/// Extract a short, whitespace-collapsed snippet around the first reference.
fn find_reference_snippet(body: &str, memo_id: &str) -> Option<String> {
  let masked = mask_references(body, memo_id);
  let pos = masked.find('◆')?;

  let start = pos.saturating_sub(80);
  let end = (pos + 80).min(masked.len());
  let snippet = masked[start..end].to_string();

  let collapsed: String = snippet
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ");
  let mut snippet = if collapsed.starts_with("…") || collapsed.starts_with("...") {
    collapsed
  } else {
    format!("…{}", collapsed)
  };
  if snippet.chars().count() > 160 {
    let truncated: String = snippet.chars().take(157).collect();
    snippet = format!("{}…", truncated);
  }
  Some(snippet)
}

/// List every memo that references `memo_id` through a `noteReference` link.
///
/// Scan-based (no index table): enumerates notebooks → memos, reads each body,
/// and greps for the serialized reference. Cheap for typical vault sizes and
/// zero-schema; can be swapped for an index-backed lookup later if needed.
#[tauri::command]
pub fn list_memo_backlinks(memo_id: String, state: State<AppState>) -> Vec<MemoBacklinkItem> {
  if memo_id.is_empty() {
    return Vec::new();
  }

  let memo_file = read_lock(&state.memo_file, "memo_file");
  let mut service = MemoService::new(&memo_file);
  let notebooks = service.list_notebooks().unwrap_or_default();

  let mut items: Vec<MemoBacklinkItem> = Vec::new();
  for notebook in notebooks {
    let entries = memo_file.read_all_memos_with_body_for_notebook_id(Some(&notebook.id));
    for (memo, body) in entries {
      if memo.id == memo_id {
        continue;
      }
      let Some(snippet) = find_reference_snippet(&body, &memo_id) else {
        continue;
      };

      let original_path = Path::new(&notebook.path)
        .join(&memo.filename)
        .to_str()
        .map(|path| path.to_string());

      let title = note_title(&memo.filename);
      items.push(MemoBacklinkItem {
        id: memo.id,
        filename: memo.filename,
        title,
        updated_at: memo.updated_at,
        notebook_id: notebook.id.clone(),
        notebook_name: notebook.name.clone(),
        notebook_path: notebook.path.clone(),
        original_path,
        snippet,
      });
    }
  }

  items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
  items
}
