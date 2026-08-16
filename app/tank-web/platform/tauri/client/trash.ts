import { invoke } from '@tauri-apps/api/core';
import type { TrashedMemo } from '@/types/trash';

export const trash = {
  list: () => invoke<TrashedMemo[]>('list_trashed_memos'),
  restore: (id: string) => invoke<boolean>('restore_trashed_memo', { id }),
  deleteForever: (id: string) =>
    invoke<boolean>('permanently_delete_trashed_memo', { id }),
  empty: () => invoke<boolean>('empty_trash'),
};
