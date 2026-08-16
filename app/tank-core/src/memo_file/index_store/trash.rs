use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::super::MemoFile;
use super::super::notebook::sqlite_to_io;

/// 跨盘符/跨设备移动文件。
/// Windows 下 `fs::rename` 不能跨盘符（如 D:\notes\x.md → C:\Users\…\.flowix\trash），
/// 失败时回退到 copy + delete，保证回收站在任意盘符的笔记本上都能正常工作。
fn move_file_cross_device(from: &Path, to: &Path) -> std::io::Result<()> {
    if fs::rename(from, to).is_err() {
        fs::copy(from, to)?;
        fs::remove_file(from)?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashedMemo {
    pub id: String,
    pub notebook_id: String,
    pub filename: String,
    pub preview: String,
    pub deleted_at: i64,
}

impl MemoFile {
    /// 列出回收站中的笔记，按删除时间倒序。
    pub fn list_trashed_memos(&self) -> std::io::Result<Vec<TrashedMemo>> {

        let conn = self.open_memo_index_db()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, notebook_id, filename, preview, deleted_at
                 FROM trashed_memos
                 ORDER BY deleted_at DESC",
            )
            .map_err(sqlite_to_io)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TrashedMemo {
                    id: row.get(0)?,
                    notebook_id: row.get(1)?,
                    filename: row.get(2)?,
                    preview: row.get(3)?,
                    deleted_at: row.get(4)?,
                })
            })
            .map_err(sqlite_to_io)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_to_io)
    }

    /// 删除单条笔记：若启用了回收站则移入回收站，否则永久删除。
    /// 本函数自己管理 `current_index_io` 锁。
    pub fn delete_memo_to_trash_global(&self, id: &str) -> std::io::Result<bool> {
        let _guard = self.current_index_io.lock().expect("index_io poisoned");
        let Some(location) = self.resolve_memo_location(id)? else {
            return Ok(false);
        };

        let path = PathBuf::from(&location.notebook.path).join(&location.memo.filename);
        let notebook_id = location.notebook.id.clone();

        let mut conn = self.open_memo_index_db()?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(sqlite_to_io)?;

        self.trash_memo_file_locked(
            &tx,
            &notebook_id,
            id,
            &path,
            &location.memo.filename,
            &location.memo.preview,
        )?;

        tx.execute(
            "DELETE FROM memos WHERE notebook_id = ?1 AND id = ?2",
            params![notebook_id, id],
        )
        .map_err(sqlite_to_io)?;
        self.mark_index_state(
            &tx,
            &notebook_id,
            crate::memo_file::MemoIndexFile::default().version,
            Utc::now().timestamp_millis(),
        )?;
        tx.commit().map_err(sqlite_to_io)?;

        if self.current_notebook_id_for_index() == notebook_id {
            let refreshed = self.read_index_from_db(&conn, &notebook_id)?;
            *self.index_cache.write().expect("index_cache poisoned") = refreshed;
        }

        Ok(true)
    }

    /// 将文件移入回收站并在已提供的事务中写入 `trashed_memos`。
    /// 调用方必须已持有 `current_index_io` 锁，本函数不再加锁。
    pub(crate) fn trash_memo_file_locked(
        &self,
        conn: &Connection,
        notebook_id: &str,
        memo_id: &str,
        original_path: &Path,
        filename: &str,
        preview: &str,
    ) -> std::io::Result<PathBuf> {
        let trash_dir = self.trash_dir.as_ref().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "trash not configured")
        })?;

        let trash_notebook_dir = trash_dir.join(notebook_id);
        fs::create_dir_all(&trash_notebook_dir)?;

        let mut trash_path = trash_notebook_dir.join(filename);
        if trash_path.exists() {
            let stem = Path::new(filename)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(memo_id);
            let ext = Path::new(filename)
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("md");
            let ts = Utc::now().timestamp_millis();
            trash_path = trash_notebook_dir.join(format!("{}-{}.{}", stem, ts, ext));
        }

        move_file_cross_device(original_path, &trash_path)?;

        conn.execute(
            "INSERT OR REPLACE INTO trashed_memos (id, notebook_id, filename, preview, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                memo_id,
                notebook_id,
                filename,
                preview,
                Utc::now().timestamp_millis(),
            ],
        )
        .map_err(sqlite_to_io)?;

        Ok(trash_path)
    }

    /// 恢复笔记到原笔记本。原文件名若已存在则自动重命名。
    pub fn restore_trashed_memo(&self, memo_id: &str) -> std::io::Result<bool> {
        let conn = self.open_memo_index_db()?;
        let trashed: Option<TrashedMemo> = conn
            .query_row(
                "SELECT id, notebook_id, filename, preview, deleted_at
                 FROM trashed_memos WHERE id = ?1",
                params![memo_id],
                |row| {
                    Ok(TrashedMemo {
                        id: row.get(0)?,
                        notebook_id: row.get(1)?,
                        filename: row.get(2)?,
                        preview: row.get(3)?,
                        deleted_at: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(sqlite_to_io)?;

        let Some(trashed) = trashed else {
            return Ok(false);
        };

        let trash_dir = self.trash_dir.as_ref().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "trash not configured")
        })?;
        let trash_path = trash_dir.join(&trashed.notebook_id).join(&trashed.filename);
        if !trash_path.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("trashed file not found: {}", trash_path.display()),
            ));
        }

        let original_notebook_path = self.memo_base_for_notebook_id(&trashed.notebook_id);
        fs::create_dir_all(&original_notebook_path)?;

        let mut restored_path = original_notebook_path.join(&trashed.filename);
        if restored_path.exists() {
            // 原位置已有同名文件，追加恢复时间戳避免覆盖。
            let stem = Path::new(&trashed.filename)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(memo_id);
            let ext = Path::new(&trashed.filename)
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("md");
            let ts = Utc::now().timestamp_millis();
            restored_path = original_notebook_path.join(format!("{}-恢复-{}.{}", stem, ts, ext));
        }

        move_file_cross_device(&trash_path, &restored_path)?;

        // 重新索引恢复的文件。
        self.register_existing_file_for_notebook_id(&trashed.notebook_id, &restored_path)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

        conn.execute(
            "DELETE FROM trashed_memos WHERE id = ?1",
            params![memo_id],
        )
        .map_err(sqlite_to_io)?;

        Ok(true)
    }

    /// 从回收站永久删除单条笔记。
    pub fn permanently_delete_trashed_memo(&self, memo_id: &str) -> std::io::Result<bool> {
        let conn = self.open_memo_index_db()?;
        let row: Option<(String, String)> = conn
            .query_row(
                "SELECT notebook_id, filename FROM trashed_memos WHERE id = ?1",
                params![memo_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(sqlite_to_io)?;

        let Some((notebook_id, filename)) = row else {
            return Ok(false);
        };

        if let Some(trash_dir) = self.trash_dir.as_ref() {
            let path = trash_dir.join(&notebook_id).join(&filename);
            if path.exists() {
                fs::remove_file(&path)?;
            }
        }

        conn.execute(
            "DELETE FROM trashed_memos WHERE id = ?1",
            params![memo_id],
        )
        .map_err(sqlite_to_io)?;

        Ok(true)
    }

    /// 清空回收站。
    pub fn empty_trash(&self) -> std::io::Result<()> {
        let conn = self.open_memo_index_db()?;
        conn.execute("DELETE FROM trashed_memos", [])
            .map_err(sqlite_to_io)?;

        if let Some(trash_dir) = self.trash_dir.as_ref() {
            if trash_dir.exists() {
                let _ = fs::remove_dir_all(trash_dir);
                let _ = fs::create_dir_all(trash_dir);
            }
        }

        Ok(())
    }

    /// 清理超过保留期的回收站笔记，返回清理数量。
    pub fn cleanup_expired_trash(&self) -> std::io::Result<usize> {
        let Some(trash_dir) = self.trash_dir.as_ref() else {
            return Ok(0);
        };

        let conn = self.open_memo_index_db()?;
        let cutoff = Utc::now().timestamp_millis()
            - (self.trash_retention_days as i64) * 24 * 60 * 60 * 1000;

        let ids: Vec<(String, String, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, notebook_id, filename FROM trashed_memos WHERE deleted_at < ?1")
                .map_err(sqlite_to_io)?;
            let rows = stmt
                .query_map(params![cutoff], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
                })
                .map_err(sqlite_to_io)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_to_io)?
        };

        for (id, notebook_id, filename) in &ids {
            let path = trash_dir.join(notebook_id).join(filename);
            if path.exists() {
                let _ = fs::remove_file(&path);
            }
            conn.execute("DELETE FROM trashed_memos WHERE id = ?1", params![id])
                .map_err(sqlite_to_io)?;
        }

        Ok(ids.len())
    }

    /// 读取回收站里某条笔记的原始内容（用于恢复前预览）。
    pub fn read_trashed_memo_content(&self, memo_id: &str) -> std::io::Result<Option<String>> {
        let Some(trash_dir) = self.trash_dir.as_ref() else {
            return Ok(None);
        };

        let conn = self.open_memo_index_db()?;
        let row: Option<(String, String)> = conn
            .query_row(
                "SELECT notebook_id, filename FROM trashed_memos WHERE id = ?1",
                params![memo_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(sqlite_to_io)?;

        let Some((notebook_id, filename)) = row else {
            return Ok(None);
        };

        let path = trash_dir.join(&notebook_id).join(&filename);
        if !path.exists() {
            return Ok(None);
        }

        fs::read_to_string(&path).map(Some)
    }
}
