import { invoke } from '@tauri-apps/api/core';

import type { Habit, HabitInput, HabitWithStats } from '@/types/habit';

export const habits = {
  list: (includeArchived = false): Promise<HabitWithStats[]> =>
    invoke<HabitWithStats[]>('list_habits', { includeArchived }),
  create: (input: HabitInput): Promise<Habit> => invoke<Habit>('create_habit', { input }),
  update: (habit: Habit): Promise<Habit> => invoke<Habit>('update_habit', { habit }),
  remove: (id: string): Promise<void> => invoke<void>('delete_habit', { id }),
  toggle: (id: string, date?: string): Promise<HabitWithStats> =>
    invoke<HabitWithStats>('toggle_habit_checkin', { id, date }),
};
