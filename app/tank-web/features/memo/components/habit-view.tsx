'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Flame, Pencil, Plus, Trash2 } from 'lucide-react';

import { habits as habitApi } from '@platform/tauri/client/habits';
import type { Habit, HabitFrequency, HabitWithStats } from '@/types/habit';
import { Button } from '@shared/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

const EMOJI_CHOICES = ['🔥', '💧', '📚', '🏃', '🧘', '💪', '🌱', '🍎', '😴', '✍️', '🎯', '🎸'];
const COLOR_CHOICES = ['#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#6366f1', '#0ea5e9', '#10b981', '#eab308'];
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

export function HabitView() {
  const [list, setList] = useState<HabitWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  const refresh = async () => {
    try {
      setList(await habitApi.list(true));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleToggle = async (id: string) => {
    const updated = await habitApi.toggle(id);
    setList((prev) => prev.map((h) => (h.habit.id === id ? updated : h)));
  };

  const handleDelete = async (h: Habit) => {
    if (!window.confirm(`删除习惯「${h.name}」？打卡记录也会一并删除。`)) return;
    await habitApi.remove(h.id);
    await refresh();
  };

  const openCreate = () => {
    setEditing(null);
    setShowDialog(true);
  };
  const openEdit = (h: Habit) => {
    setEditing(h);
    setShowDialog(true);
  };

  return (
    <div className="px-4 py-4 max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Flame className="w-5 h-5 text-orange-500" /> 习惯追踪
        </div>
        <Button
          size="sm"
          className="bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90"
          onClick={openCreate}
        >
          <Plus className="w-4 h-4 mr-1" /> 新建习惯
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--muted-foreground)] py-10 text-center">加载中…</div>
      ) : list.length === 0 ? (
        <div className="text-sm text-[var(--muted-foreground)] py-10 text-center">
          还没有习惯，点右上角「新建习惯」开始追踪你的日常作息。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {list.map((hw) => (
            <HabitCard
              key={hw.habit.id}
              data={hw}
              onToggle={() => handleToggle(hw.habit.id)}
              onEdit={() => openEdit(hw.habit)}
              onDelete={() => handleDelete(hw.habit)}
            />
          ))}
        </div>
      )}

      {showDialog && (
        <HabitDialog
          initial={editing}
          onClose={() => {
            setShowDialog(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setShowDialog(false);
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function HabitCard({
  data,
  onToggle,
  onEdit,
  onDelete,
}: {
  data: HabitWithStats;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { habit, streak, bestStreak, checkedToday, last7Days, checkedDates } = data;
  const checkedSet = useMemo(() => new Set(checkedDates), [checkedDates]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <span className="text-2xl leading-none">{habit.emoji || '🔥'}</span>
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate" style={{ color: habit.color }}>
            {habit.name}
          </div>
          {habit.description && (
            <div className="text-xs text-[var(--muted-foreground)] line-clamp-1">
              {habit.description}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            title="编辑"
            className="p-1 rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="删除"
            className="p-1 rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 text-sm">
        <span className="flex items-center gap-1" style={{ color: habit.color }}>
          <Flame className="w-4 h-4" /> 连续 {streak} 天
        </span>
        <span className="text-[var(--muted-foreground)]">最佳 {bestStreak}</span>
        {habit.reminderTime && (
          <span className="text-[var(--muted-foreground)] flex items-center gap-1">
            ⏰ {habit.reminderTime}
          </span>
        )}
      </div>

      <div className="flex gap-1">
        {last7Days.map((d) => {
          const on = checkedSet.has(d);
          const dayName = WEEKDAY[new Date(`${d}T00:00:00`).getDay()];
          return (
            <div key={d} className="flex-1 text-center">
              <div
                className={cn(
                  'h-7 rounded-md flex items-center justify-center text-xs',
                  on ? 'text-white' : 'bg-[var(--muted)] text-[var(--muted-foreground)]',
                )}
                style={on ? { backgroundColor: habit.color } : undefined}
              >
                {on ? <Check className="w-4 h-4" /> : null}
              </div>
              <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">{dayName}</div>
            </div>
          );
        })}
      </div>

      <Button
        size="sm"
        className={cn(
          'w-full',
          !checkedToday && 'bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90',
        )}
        variant={checkedToday ? 'outline' : 'default'}
        onClick={onToggle}
      >
        {checkedToday ? '今日已打卡 ✓ 点击取消' : '今日打卡'}
      </Button>
    </div>
  );
}

function HabitDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Habit | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [emoji, setEmoji] = useState(initial?.emoji ?? '🔥');
  const [color, setColor] = useState(initial?.color ?? '#f97316');
  const [frequency, setFrequency] = useState<HabitFrequency>(initial?.frequency ?? 'daily');
  const [targetPerWeek, setTargetPerWeek] = useState(initial?.targetPerWeek ?? 7);
  const [reminderTime, setReminderTime] = useState(initial?.reminderTime ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (isEdit && initial) {
        await habitApi.update({
          ...initial,
          name: name.trim(),
          description,
          emoji,
          color,
          frequency,
          targetPerWeek,
          reminderTime,
        });
      } else {
        await habitApi.create({ name: name.trim(), description, emoji, color, frequency, targetPerWeek, reminderTime });
      }
      onSaved();
    } catch (err) {
      console.error('[HabitDialog] save failed:', err);
      toast.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'border border-[var(--border)] rounded-md px-2 py-1.5 text-sm bg-[var(--background)] w-full';
  const labelCls = 'text-xs text-[var(--muted-foreground)]';

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md w-[92vw]">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑习惯' : '新建习惯'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <div className={labelCls + ' mb-1'}>图标</div>
            <div className="flex flex-wrap gap-1">
              {EMOJI_CHOICES.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  className={cn(
                    'w-8 h-8 rounded-md text-lg flex items-center justify-center border',
                    emoji === e ? 'border-[var(--primary)] bg-[var(--muted)]' : 'border-[var(--border)]',
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className={labelCls + ' mb-1'}>名称</div>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="如 每天阅读 30 分钟" />
          </div>

          <div>
            <div className={labelCls + ' mb-1'}>描述（可选）</div>
            <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="为什么要做这件事" />
          </div>

          <div>
            <div className={labelCls + ' mb-1'}>颜色</div>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_CHOICES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    'w-6 h-6 rounded-full border-2',
                    color === c ? 'border-[var(--foreground)]' : 'border-transparent',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <div className={labelCls + ' mb-1'}>频率</div>
              <select
                className={inputCls}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as HabitFrequency)}
              >
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="custom">自定义</option>
              </select>
            </div>
            <div className="flex-1">
              <div className={labelCls + ' mb-1'}>每周目标次数</div>
              <input
                type="number"
                min={1}
                max={7}
                className={inputCls}
                value={targetPerWeek}
                onChange={(e) => setTargetPerWeek(Number(e.target.value) || 7)}
              />
            </div>
          </div>

          <div>
            <div className={labelCls + ' mb-1'}>每日提醒时间（留空=不提醒）</div>
            <input
              type="time"
              className={inputCls}
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            className="bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90"
            onClick={save}
            disabled={saving || !name.trim()}
          >
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
