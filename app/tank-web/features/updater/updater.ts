import { check, type Update } from '@platform/tauri/updater';
import { relaunch } from '@platform/tauri/process';

export interface UpdateDownloadProgress {
  /** 已下载字节数 */
  downloaded: number;
  /** 总字节数（未知时为 0） */
  total: number;
  /** 0..1 下载进度 */
  fraction: number;
}

/**
 * 调用 Tauri 原生更新器检查更新。返回 `null` 表示已是最新（或无可用更新）。
 *
 * 注意：在 dev 环境 / `tauri.conf.json` 未配置有效 `plugins.updater.endpoints`
 * 时此调用会 reject —— 调用方应自行处理（开发期可忽略）。
 */
export async function checkForAppUpdate(): Promise<Update | null> {
  return check();
}

/**
 * 下载并安装更新包。安装完成后需调用 {@link relaunchApp} 重启生效。
 * `onProgress` 回调的累计进度由 chunkLength 自行累加得出（此版本
 * `DownloadEvent` 不含累计 downloaded 字段）。
 */
export async function downloadAndInstallUpdate(
  update: Update,
  onProgress?: (progress: UpdateDownloadProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? 0;
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength;
      onProgress?.({ downloaded, total, fraction: total > 0 ? downloaded / total : 0 });
    }
  });
}

/** 重启应用以完成更新安装。仅在 downloadAndInstall 成功后调用。 */
export async function relaunchApp(): Promise<void> {
  await relaunch();
}
