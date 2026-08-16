import { useEffect } from 'react';
import { checkForAppUpdate } from './updater';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';

/**
 * 应用启动时静默检查一次更新（仅检查，不自动下载/重启）。
 * 若发现可用更新，弹 info 提示用户去「设置 → 通用 → 检查更新」手动更新。
 *
 * - MainLayout 常驻挂载，本 hook 每次启动只跑一次。
 * - dev / 未配置端点 / 网络失败均静默忽略，不影响正常使用。
 */
export function useAppUpdateAutoCheck(): void {
  const { t } = useI18n();
  useEffect(() => {
    let cancelled = false;
    checkForAppUpdate()
      .then((update) => {
        if (cancelled || !update) return;
        toast.info(
          t('preferences.general.productUpdates.available', { version: update.version }),
        );
      })
      .catch(() => {
        // 静默：开发期或网络/配置问题不应打扰用户
      });
    return () => {
      cancelled = true;
    };
  }, [t]);
}
