'use client';

import { useCallback, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { useAppUpdateStore } from '@features/updater/update-store';
import { downloadAndInstallUpdate, relaunchApp } from '@features/updater/updater';

export function ProductUpdatePill() {
  const { t } = useI18n();
  const available = useAppUpdateStore((state) => state.available);
  const version = useAppUpdateStore((state) => state.version);
  const update = useAppUpdateStore((state) => state.update);
  const downloading = useAppUpdateStore((state) => state.downloading);
  const progress = useAppUpdateStore((state) => state.progress);
  const setDownloading = useAppUpdateStore((state) => state.setDownloading);
  const setProgress = useAppUpdateStore((state) => state.setProgress);
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = useCallback(async () => {
    if (!update || downloading) return;
    setDownloading(true);
    try {
      toast.info(t('preferences.general.productUpdates.downloading', { version: update.version }));
      await downloadAndInstallUpdate(update, (p) => setProgress(p));
      await relaunchApp();
    } catch (error) {
      setDownloading(false);
      toast.error(t('preferences.general.productUpdates.failed'));
      // eslint-disable-next-line no-console
      console.error('[ProductUpdatePill] update failed', error);
    }
  }, [update, downloading, setDownloading, setProgress, t]);

  if (!available) return null;

  const label = downloading
    ? progress && progress.total > 0
      ? `${Math.round(progress.fraction * 100)}%`
      : t('preferences.general.productUpdates.downloading', { version: version ?? '' })
    : t('status.upgrade');

  const title = downloading
    ? t('preferences.general.productUpdates.downloading', { version: version ?? '' })
    : version
      ? `${t('status.upgrade')} ${version}`
      : t('status.upgrade');

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={downloading}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={title}
      className={cn(
        'relative inline-flex h-[22px] items-center gap-0.5 overflow-hidden rounded-md px-2',
        'bg-[var(--info)] text-[var(--info-foreground)]',
        'hover:opacity-90 active:opacity-80',
        'disabled:cursor-wait disabled:opacity-80',
        'text-xs leading-none font-medium',
      )}
      aria-label={label}
    >
      {downloading && progress && progress.total > 0 && (
        <span
          className="absolute inset-y-0 left-0 bg-[var(--info-foreground)] opacity-20"
          style={{ width: `${Math.max(0, Math.min(1, progress.fraction)) * 100}%` }}
        />
      )}
      <ArrowUp className="h-3 w-3 shrink-0" />
      <span className="relative z-10 truncate">{isHovered && !downloading && version ? version : label}</span>
    </button>
  );
}
