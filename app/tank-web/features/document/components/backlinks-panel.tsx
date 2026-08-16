'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { memos, type BacklinkItem } from '@platform/tauri/client';
import { openNoteByMemoId } from '@features/memo/use-cases/open-by-target';
import { useI18n } from '@/lib/i18n';

interface BacklinksPanelProps {
  memoId: string;
}

/**
 * "谁链接了这篇笔记" 面板 —— 反向链接 (backlinks)。
 *
 * 直接调用后端 `list_memo_backlinks` (实时扫描, 零 schema 改动) 拿到所有引用
 * 当前 memo 的笔记, 点击即可跳转。默认展开, 无反链时显示空态。
 * 标题用 count-up 动画展示「此笔记共被 N 篇引用」。
 */
export function BacklinksPanel({ memoId }: BacklinksPanelProps) {
  const { t } = useI18n();
  const [backlinks, setBacklinks] = useState<BacklinkItem[] | null>(null);
  const [open, setOpen] = useState(true);
  // count-up 动画: 数字从当前显示值平滑滚动到目标反链数
  const displayRef = useRef(0);
  const [displayCount, setDisplayCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setBacklinks(null);
    memos
      .listMemoBacklinks(memoId)
      .then((items) => {
        if (!cancelled) setBacklinks(items);
      })
      .catch(() => {
        if (!cancelled) setBacklinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [memoId]);

  // 反链数变化 → 数字滚动动画 (easeOutCubic)
  useEffect(() => {
    const target = backlinks ? backlinks.length : 0;
    const from = displayRef.current;
    if (from === target) return;
    let raf = 0;
    const start = performance.now();
    const duration = 450;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const value = Math.round(from + (target - from) * eased);
      displayRef.current = value;
      setDisplayCount(value);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [backlinks]);

  const handleOpen = useCallback((id: string) => {
    openNoteByMemoId(id);
  }, []);

  const headerTitle =
    backlinks === null
      ? t('document.backlinks.title')
      : displayCount > 0
        ? t('document.backlinks.titleWithCount', { count: displayCount })
        : t('document.backlinks.title');

  return (
    <div className="backlinks-panel border-t border-[var(--border)] bg-[var(--background)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="backlinks-header w-full flex items-center gap-2 px-4 h-9 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
        aria-expanded={open}
      >
        <ChevronDown
          className={`backlinks-chevron h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`}
          aria-hidden="true"
        />
        <span className="backlinks-title-count tabular-nums">{headerTitle}</span>
      </button>
      {open && (
        <div className="backlinks-body max-h-[280px] overflow-y-auto px-2 pb-2">
          {backlinks === null ? (
            <div className="backlinks-loading px-2 py-3 text-xs text-[var(--muted-foreground)]">
              {t('document.backlinks.loading')}
            </div>
          ) : backlinks.length === 0 ? (
            <div className="backlinks-empty px-2 py-3 text-xs text-[var(--muted-foreground)]">
              {t('document.backlinks.empty')}
            </div>
          ) : (
            <ul className="backlinks-list flex flex-col gap-1">
              {backlinks.map((item) => (
                <li key={`${item.notebookId}:${item.id}`}>
                  <button
                    type="button"
                    onClick={() => handleOpen(item.id)}
                    className="backlinks-item w-full text-left rounded-lg px-2 py-1.5 hover:bg-[var(--muted)]"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="backlinks-item-title truncate text-sm text-[var(--foreground)]">
                        {item.title}
                      </span>
                      <span className="backlinks-item-notebook shrink-0 text-[10px] text-[var(--muted-foreground)]">
                        {item.notebookName}
                      </span>
                    </span>
                    {item.snippet && (
                      <span className="backlinks-item-snippet mt-0.5 block text-xs text-[var(--muted-foreground)] line-clamp-2">
                        {item.snippet}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
