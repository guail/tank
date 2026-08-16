/**
 * Tauri 更新器插件的 platform 封装。
 *
 * features 通过此模块访问更新器 API, 不直接 import @tauri-apps/plugin-updater。
 */
export { check, type Update, type DownloadEvent } from '@tauri-apps/plugin-updater';
