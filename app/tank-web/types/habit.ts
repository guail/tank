export type HabitFrequency = 'daily' | 'weekly' | 'custom';

export interface Habit {
  id: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  frequency: HabitFrequency;
  targetPerWeek: number;
  createdAt: number;
  archived: boolean;
  position: number;
  /** 每日提醒时间 "HH:MM"，空字符串表示不提醒 */
  reminderTime: string;
}

export interface HabitInput {
  name: string;
  description?: string;
  emoji?: string;
  color?: string;
  frequency?: HabitFrequency;
  targetPerWeek?: number;
  reminderTime?: string;
}

export interface HabitWithStats {
  habit: Habit;
  streak: number;
  bestStreak: number;
  totalCheckins: number;
  checkedToday: boolean;
  last7Days: string[];
  checkedDates: string[];
}
