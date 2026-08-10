//! Stable-revision self-write reconciliation.
//!
//! The notify callback never drops a path merely because it was recently
//! written. The worker calls this module only after the file settles.

use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::watcher::filter::{SelfWriteMap, SELF_WRITE_TTL};

/// Return true when the path was recently written by a backend-owned
/// operation, so the stable on-disk change is the echo of that write rather
/// than an external edit.
///
/// Matching is by path within `SELF_WRITE_TTL` — we deliberately do NOT
/// require the stable revision to equal the exact revision captured at write
/// time. Under fast typing the backend issues several autosaves per second,
/// and the mark for an earlier autosave is overwritten by a later one before
/// its echo is processed; a strict revision compare would then mislabel the
/// echo as an external edit (spurious "external modification" reloads / list
/// flicker). Claiming any write to a recently backend-written path — the
/// immediate echo — suppresses those false positives.
///
/// The mark is *not* consumed on a hit: while the user keeps editing, each
/// autosave refreshes `marked_at`, so every echo in the burst is suppressed.
/// A genuine external edit that lands after editing pauses (once the TTL
/// lapses) is still treated as external.
pub fn is_recent_self_write(
    path: &Path,
    recent_self_writes: &Arc<Mutex<SelfWriteMap>>,
) -> bool {
    let key = crate::watcher::path::normalize_for_compare(path);
    let Ok(mut map) = recent_self_writes.lock() else {
        return false;
    };
    // Prune expired entries so the table stays bounded. The TTL is short
    // enough that a genuine external edit after the user stops typing is
    // detected once the mark expires.
    map.retain(|_, mark| mark.marked_at.elapsed() < SELF_WRITE_TTL);

    let hit = map.get(&key).is_some();
    if hit {
        tracing::debug!(
            "[SelfWriteSuppressor] HIT path={} key={} table_size={}",
            path.display(),
            key.display(),
            map.len(),
        );
    } else {
        tracing::debug!(
            "[SelfWriteSuppressor] MISS path={} key={} table_size={}",
            path.display(),
            key.display(),
            map.len(),
        );
    }
    // Intentionally keep the entry: during a fast-typing burst the same path
    // may emit multiple notify echoes (Metadata + Data on macOS, rapid
    // autosaves on all platforms). The worker's processed-revisions map
    // handles exact duplicate stable revisions; the TTL handles expiration.
    hit
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watcher::filter::{SelfWriteMap, SelfWriteMark};
    use std::time::Instant;

    fn marked_writes(path: &std::path::Path) -> Arc<Mutex<SelfWriteMap>> {
        let writes = Arc::new(Mutex::new(SelfWriteMap::new()));
        writes.lock().unwrap().insert(
            crate::watcher::path::normalize_for_compare(path),
            SelfWriteMark {
                marked_at: Instant::now(),
            },
        );
        writes
    }

    #[test]
    fn suppresses_a_recently_self_written_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("memo.md");
        std::fs::write(&path, "first revision").unwrap();
        let writes = marked_writes(&path);

        assert!(is_recent_self_write(&path, &writes));
    }

    #[test]
    fn suppresses_a_new_revision_on_the_same_recently_self_written_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("memo.md");
        std::fs::write(&path, "ui revision").unwrap();
        let writes = marked_writes(&path);
        std::fs::write(&path, "agent revision").unwrap();

        // 即使 revision 变了, 只要路径在 TTL 内被后端写过就认领 (快打字场景)
        assert!(is_recent_self_write(&path, &writes));
    }

    #[test]
    fn passes_a_path_with_no_recent_self_write() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("memo.md");
        std::fs::write(&path, "external revision").unwrap();
        let writes = Arc::new(Mutex::new(SelfWriteMap::new()));

        assert!(!is_recent_self_write(&path, &writes));
    }
}
