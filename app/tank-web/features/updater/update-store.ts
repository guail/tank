import { create } from 'zustand';
import type { Update } from '@platform/tauri/updater';

export interface UpdateProgress {
  downloaded: number;
  total: number;
  fraction: number;
}

interface AppUpdateState {
  available: boolean;
  version: string | null;
  update: Update | null;
  downloading: boolean;
  progress: UpdateProgress | null;
  setAvailable: (update: Update) => void;
  clear: () => void;
  setDownloading: (value: boolean) => void;
  setProgress: (progress: UpdateProgress) => void;
}

export const useAppUpdateStore = create<AppUpdateState>((set) => ({
  available: false,
  version: null,
  update: null,
  downloading: false,
  progress: null,
  setAvailable: (update) =>
    set({
      available: true,
      version: update.version,
      update,
      downloading: false,
      progress: null,
    }),
  clear: () =>
    set({
      available: false,
      version: null,
      update: null,
      downloading: false,
      progress: null,
    }),
  setDownloading: (value) => set({ downloading: value }),
  setProgress: (progress) => set({ progress }),
}));
