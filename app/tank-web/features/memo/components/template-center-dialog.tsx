'use client';

import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Trash2, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { memos, type MemoTemplate } from '@platform/tauri/client';
import { useMemoStore } from '@features/memo';
import { openMemoSession } from '@features/memo/components/open-memo-session';
import {
  BUILT_IN_TEMPLATES,
  BUILT_IN_BY_NAME,
  getSeededSlugs,
  markSeeded,
} from '@features/memo/data/built-in-templates';

interface TemplateCenterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** react-markdown 元素 -> 紧凑预览样式，避免引入额外 CSS 文件。 */
const PREVIEW_COMPONENTS = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <div className="text-sm font-bold mt-1 mb-0.5 leading-tight">{children}</div>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <div className="text-[13px] font-semibold mt-1.5 mb-0.5 leading-tight text-[var(--foreground)]">
      {children}
    </div>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <div className="text-xs font-semibold mt-1 mb-0.5 leading-tight">{children}</div>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-xs my-0.5 leading-snug">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-4 my-0.5 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-4 my-0.5 space-y-0.5">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="text-xs leading-snug break-words">{children}</li>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-[var(--border)] pl-2 text-xs text-[var(--muted-foreground)] my-1">
      {children}
    </blockquote>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="text-[11px] bg-[var(--muted)] rounded px-1 py-0.5">{children}</code>
  ),
} as const;

export function TemplateCenterDialog({ open, onOpenChange }: TemplateCenterDialogProps) {
  const { t } = useI18n();
  const [templates, setTemplates] = useState<MemoTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  // 打开时拉取模板列表，并把缺失的内置模板种入（已删除的不复活）。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const existing = await memos.listTemplates();
        const existingNames = new Set(existing.map((tpl) => tpl.name));
        const seeded = getSeededSlugs();

        const toSeed = BUILT_IN_TEMPLATES.filter(
          (b) => !seeded.has(b.slug) && !existingNames.has(b.name),
        );
        for (const b of toSeed) {
          await memos.saveTemplate(b.name, b.content);
        }
        if (toSeed.length > 0) {
          markSeeded(toSeed.map((b) => b.slug));
        }

        const fresh = await memos.listTemplates();
        if (!cancelled) setTemplates(fresh);
      } catch (err) {
        if (!cancelled) {
          toast.error(`${t('memo.templateCenter.failedLoad')}: ${String(err)}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  const isBuiltIn = useMemo(() => {
    const names = new Set(BUILT_IN_TEMPLATES.map((b) => b.name));
    return (tpl: MemoTemplate) => names.has(tpl.name);
  }, []);

  const handleUse = async (template: MemoTemplate) => {
    const state = useMemoStore.getState();
    if (!state.selectedNotebook) {
      toast.error(t('memo.templateCenter.needNotebook'));
      return;
    }
    try {
      const memo = await memos.createFromTemplate(template.id, state.selectedNotebook.id);
      state.handleMemoCreated(memo, { select: true });
      openMemoSession({ ...memo, isOpen: true }, state.selectedNotebook);
      onOpenChange(false);
    } catch (err) {
      toast.error(`${t('memo.templateCenter.failedUse')}: ${String(err)}`);
    }
  };

  const handleDelete = async (template: MemoTemplate) => {
    try {
      await memos.deleteTemplate(template.id);
      setTemplates((prev) => prev.filter((tpl) => tpl.id !== template.id));
      setConfirmingDelete(null);
    } catch (err) {
      toast.error(`${t('memo.templateCenter.failedDelete')}: ${String(err)}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[920px] w-[92vw] max-h-[86vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[var(--border)]">
          <DialogTitle className="flex items-center gap-2">
            <span>{t('memo.templateCenter.title')}</span>
          </DialogTitle>
          <DialogDescription>{t('memo.templateCenter.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--muted-foreground)]">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('memo.templateCenter.seeding')}
            </div>
          ) : templates.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">
              {t('memo.templateCenter.empty')}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((tpl) => {
                const builtIn = isBuiltIn(tpl);
                const previewContent = builtIn ? BUILT_IN_BY_NAME.get(tpl.name)?.content : '';
                return (
                  <div
                    key={tpl.id}
                    className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--card)] hover:shadow-md hover:border-[var(--primary)]/40 transition-colors"
                  >
                    <div className="flex items-start gap-2 px-3 pt-3">
                      <span className="text-lg leading-none mt-0.5">{builtIn ? BUILT_IN_BY_NAME.get(tpl.name)?.emoji : '📄'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold truncate">{tpl.name}</span>
                          <span
                            className={cn(
                              'shrink-0 text-[10px] px-1.5 py-0.5 rounded-full',
                              builtIn
                                ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                                : 'bg-[var(--muted)] text-[var(--muted-foreground)]',
                            )}
                          >
                            {builtIn ? t('memo.templateCenter.builtin') : t('memo.templateCenter.custom')}
                          </span>
                        </div>
                        {builtIn && (
                          <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 line-clamp-1">
                            {BUILT_IN_BY_NAME.get(tpl.name)?.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* 内容预览 / 缩略 */}
                    <div className="relative mx-3 mt-2 rounded-lg bg-[var(--muted)]/40 px-3 py-2 overflow-hidden">
                      <div className="max-h-40 overflow-hidden">
                        {previewContent ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={PREVIEW_COMPONENTS}>
                            {previewContent}
                          </ReactMarkdown>
                        ) : (
                          <p className="text-xs text-[var(--muted-foreground)] italic">
                            {t('memo.templateCenter.noPreview')}
                          </p>
                        )}
                      </div>
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[var(--muted)]/60 to-transparent" />
                    </div>

                    <div className="flex items-center justify-between gap-2 px-3 py-3 mt-1">
                      <Button
                        size="sm"
                        className="flex-1 bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90"
                        onClick={() => void handleUse(tpl)}
                      >
                        {t('memo.templateCenter.use')}
                      </Button>
                      {confirmingDelete === tpl.id ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="shrink-0"
                          onClick={() => void handleDelete(tpl)}
                        >
                          {t('memo.templateCenter.confirmDelete')}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 px-2"
                          aria-label={t('memo.templateCenter.delete')}
                          onClick={() => setConfirmingDelete(tpl.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
