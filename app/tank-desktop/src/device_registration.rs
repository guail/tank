//! 本地启动元数据：管理 `~/.flowix/boot/boot.json` 的 schema 版本与
//! `experimental` 实验特性开关。
//!
//! 仅读写本机文件，不发起任何网络请求、不上报到任何外部服务器。
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// `~/.flowix/boot/` 目录内的文件名（与 `system.json` 平级）。
const BOOT_FILE_NAME: &str = "boot.json";
/// 当前文件结构版本。不匹配则按无效处理（落到 `fresh()`）。
/// v2: 嵌套结构──顶层 `{schemaVersion, userInfo}`，`userInfo` 内放全部字段。
const BOOT_SCHEMA_VERSION: u32 = 2;

/// `~/.flowix/boot/boot.json` 顶层结构。
///
/// 多项并存──后续若有更长期的元数据（例如 `featureFlags`、某类本地 cache），
/// 加 sibling 即可，不互相覆盖。登记相关的全部字段收在 `userInfo` 子对象里。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootFile {
    pub schema_version: u32,
    #[serde(default)]
    pub experimental: bool,
    #[serde(default)]
    pub user_info: UserInfo,
}

/// 设备元数据子对象：保存随机设备 ID 与安装时间。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    pub device_id: Uuid,
    pub installed_at: DateTime<Utc>,
    #[serde(default)]
    pub registered: bool,
    #[serde(default)]
    pub registered_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub supabase_row_id: Option<String>,
    #[serde(default)]
    pub last_attempt_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_attempt_error: Option<String>,
    #[serde(default)]
    pub attempts: u32,
    pub app_version_at_install: String,
}

/// 进程内单例：以 `RwLock` 持有 `BootFile` 与路径。
pub struct DeviceRegistry {
    path: PathBuf,
    inner: RwLock<BootFile>,
}

impl DeviceRegistry {
    /// 加载或新建 boot.json。如果文件不存在或解析失败，直接落回 `fresh()`。
    /// 不在错误时 panic──文件失败比任何登记失败都严重得多。
    pub fn load(user_config_dir: &Path, _app_version: impl Into<String>) -> Self {
        let path = user_config_dir.join("boot").join(BOOT_FILE_NAME);
        if let Some(parent) = path.parent() {
            // best-effort, 文件已存在就能正常读；不存在时 `read_from_disk` 返回 None
            let _ = std::fs::create_dir_all(parent);
        }
        let boot = Self::read_from_disk(&path).unwrap_or_else(|| {
            tracing::info!(
                "[device-reg] no boot.json at {}; creating a fresh record",
                path.display()
            );
            Self::fresh()
        });
        Self {
            path,
            inner: RwLock::new(boot),
        }
    }

    /// Whether this client exposes experimental product features.
    /// Missing `experimental` in an existing v2 boot.json deserializes as false.
    pub fn experimental(&self) -> bool {
        self.read().experimental
    }

    fn read(&self) -> RwLockReadGuard<'_, BootFile> {
        self.inner.read().unwrap_or_else(|poisoned| {
            tracing::error!("[device-reg] boot.json lock poisoned, recovering");
            poisoned.into_inner()
        })
    }

    fn write(&self) -> RwLockWriteGuard<'_, BootFile> {
        self.inner.write().unwrap_or_else(|poisoned| {
            tracing::error!("[device-reg] boot.json lock poisoned, recovering");
            poisoned.into_inner()
        })
    }

    fn read_from_disk(path: &Path) -> Option<BootFile> {
        let content = std::fs::read_to_string(path).ok()?;
        let boot: BootFile = match serde_json::from_str(&content) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(
                    "[device-reg] boot.json parse error at {}: {e}; falling back to fresh record",
                    path.display()
                );
                return None;
            }
        };
        if boot.schema_version != BOOT_SCHEMA_VERSION {
            tracing::warn!(
                "[device-reg] boot.json schema_version mismatch (got {}, expected {}); falling back to fresh record",
                boot.schema_version,
                BOOT_SCHEMA_VERSION
            );
            return None;
        }
        Some(boot)
    }

    /// 原子写：tmp + fsync + rename + chmod 600。和 `system_data.rs` 一致。
    fn flush(&self, boot: &BootFile) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(boot)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let tmp = self.path.with_extension("json.tmp");
        {
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&tmp)?;
            f.write_all(content.as_bytes())?;
            f.sync_all()?;
        }
        set_file_owner_only_perms(&tmp);
        std::fs::rename(&tmp, &self.path)?;
        set_file_owner_only_perms(&self.path);
        Ok(())
    }

    /// 全新首次安装时生成的初始 record。`installed_at` 锁定为当前时间。
    fn fresh() -> BootFile {
        BootFile {
            schema_version: BOOT_SCHEMA_VERSION,
            experimental: false,
            user_info: UserInfo {
                device_id: Uuid::new_v4(),
                installed_at: Utc::now(),
                registered: false,
                registered_at: None,
                supabase_row_id: None,
                last_attempt_at: None,
                last_attempt_error: None,
                attempts: 0,
                app_version_at_install: env!("CARGO_PKG_VERSION").to_string(),
            },
        }
    }
}

#[cfg(unix)]
fn set_file_owner_only_perms(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let perms = std::fs::Permissions::from_mode(0o600);
    let _ = std::fs::set_permissions(path, perms);
}

#[cfg(not(unix))]
fn set_file_owner_only_perms(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_boot() -> BootFile {
        DeviceRegistry::fresh()
    }

    #[test]
    fn fresh_has_valid_defaults() {
        let b = fresh_boot();
        assert_eq!(b.schema_version, BOOT_SCHEMA_VERSION);
        assert!(!b.experimental);
        assert!(!b.user_info.registered);
        assert_eq!(b.user_info.attempts, 0);
        assert!(b.user_info.registered_at.is_none());
        assert!(b.user_info.last_attempt_error.is_none());
    }

    #[test]
    fn roundtrip_serde() {
        let mut b = fresh_boot();
        b.experimental = true;
        let s = serde_json::to_string(&b).unwrap();
        let v: BootFile = serde_json::from_str(&s).unwrap();
        assert!(v.experimental);
        assert_eq!(b.user_info.device_id, v.user_info.device_id);
        assert_eq!(b.user_info.installed_at, v.user_info.installed_at);
        assert_eq!(
            b.user_info.app_version_at_install,
            v.user_info.app_version_at_install
        );
    }

    #[test]
    fn missing_experimental_defaults_to_false() {
        let mut value = serde_json::to_value(fresh_boot()).unwrap();
        value.as_object_mut().unwrap().remove("experimental");
        let boot: BootFile = serde_json::from_value(value).unwrap();
        assert!(!boot.experimental);
    }

    #[test]
    fn schema_mismatch_falls_back_to_fresh() {
        let tmp = tempdir_path();
        std::fs::write(
            &tmp,
            r#"{"schemaVersion":999,"userInfo":{"deviceId":"00000000-0000-0000-0000-000000000000","installedAt":"2026-01-01T00:00:00Z","registered":true,"appVersionAtInstall":"1.0.0"}}"#,
        )
        .unwrap();
        let direct = DeviceRegistry::read_from_disk(&tmp);
        assert!(
            direct.is_none(),
            "schemaVersion mismatch should produce None"
        );
    }

    #[test]
    fn old_v1_flat_schema_is_rejected() {
        // 旧版 flat 顶层字段结构 (v1)──升级到 v2 后旧文件应被拒绝，落到 fresh()。
        let tmp = tempdir_path();
        std::fs::write(
            &tmp,
            r#"{"schemaVersion":1,"deviceId":"00000000-0000-0000-0000-000000000000","installedAt":"2026-01-01T00:00:00Z","registered":true,"appVersionAtInstall":"1.0.0"}"#,
        )
        .unwrap();
        assert!(
            DeviceRegistry::read_from_disk(&tmp).is_none(),
            "v1 flat schema must be rejected (schemaVersion mismatch)"
        );
    }

    #[test]
    fn nested_user_info_roundtrips_via_json() {
        let b = fresh_boot();
        let json = serde_json::to_string(&b).unwrap();
        assert!(json.contains("\"schemaVersion\""));
        assert!(json.contains("\"userInfo\""));
        assert!(json.contains("\"deviceId\""));
        // 校验 userInfo 嵌套：deviceId 不在顶层
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(
            parsed.get("deviceId").is_none(),
            "deviceId must be nested under userInfo, not top-level"
        );
        assert!(parsed["userInfo"].get("deviceId").is_some());
    }

    fn tempdir_path() -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "tank-device-reg-test-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        let _ = std::fs::remove_file(&dir);
        dir
    }
}
