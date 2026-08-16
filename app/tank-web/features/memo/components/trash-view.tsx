'use client';

import { useEffect, useState } from 'react';
import { RotateCcw, Trash2, AlertTriangle } from 'lucide-react';
import { trash as trashClient } from '@platform/tauri/client';
import { displayTitleFromFilename } from '@/lib/utils';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import type { TrashedMemo } from '@/types/trash';

function formatDeletedAt(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function TrashView({ onRestored }: { onRestored?: () => void }) {
  const [items, setItems] = useState<TrashedMemo[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TrashedMemo | null>(null);

  const load = async () => {
    try {
      const list = await trashClient.list();
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleRestore = async (id: string) => {
    const ok = await trashClient.restore(id);
    if (ok) {
      await load();
      onRestored?.();
    }
  };

  const handleDeleteForever = async (id: string) => {
    const ok = await trashClient.deleteForever(id);
    if (ok) {
      setConfirmDelete(null);
      await load();
    }
  };

  const handleEmpty = async () => {
    const ok = await trashClient.empty();
    if (ok) {
      setConfirmEmpty(false);
      await load();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
          <Trash2 className="h-4 w-4 text-[var(--muted-foreground)]" />
          <span>回收站</span>
          <span className="text-xs text-[var(--muted-foreground)]">（30 天内可恢复）</span>
        </div>
        {items.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            onClick={() => setConfirmEmpty(true)}
          >
            清空
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading ? (
          <p className="px-2 py-3 text-xs text-[var(--muted-foreground)]">加载中…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-[var(--muted-foreground)]">
            <Trash2 className="h-8 w-8 opacity-40" />
            <p className="text-xs">回收站是空的</p>
          </div>
        ) : (
          <div className="space-y-1">
            {items.map((item) => (
              <div
                key={item.id}
                className="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-[var(--muted)]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-[var(--foreground)]">
                    {displayTitleFromFilename(item.filename)}
                  </p>
                  <p className="truncate text-[11px] text-[var(--muted-foreground)]">
                    {item.preview || ' '} · {formatDeletedAt(item.deletedAt)}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100"
                  onClick={() => handleRestore(item.id)}
                  title="恢复"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-red-600 opacity-0 group-hover:opacity-100 hover:text-red-700"
                  onClick={() => setConfirmDelete(item)}
                  title="永久删除"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!confirmDelete} onOpenChange={(open: boolean) => !open && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              永久删除
            </DialogTitle>
            <DialogDescription>
              确定要永久删除「{displayTitleFromFilename(confirmDelete?.filename ?? '')}」吗？
              删除后将无法恢复。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && handleDeleteForever(confirmDelete.id)}
            >
              永久删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmEmpty} onOpenChange={(open: boolean) => !open && setConfirmEmpty(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              清空回收站
            </DialogTitle>
            <DialogDescription>
              确定要清空回收站吗？里面 {items.length} 条笔记将被永久删除，无法恢复。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmEmpty(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleEmpty}>
              清空
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
