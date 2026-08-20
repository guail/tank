'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { memos as memosClient } from '@platform/tauri/client';
import { useMemoStore } from '@features/memo';
import type { MemoTodoEntry } from '@/types/memo-item';
import { cn, displayTitleFromFilename } from '@/lib/utils';
import { PRIORITY_COLORS } from '@features/editor/extensions/rich-task-item/task-fields';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function prioRank(p: string): number {
  return p === 'high' ? 3 : p === 'medium' ? 2 : p === 'low' ? 1 : 0;
}

function toDateStr(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/// 任务落点: 优先用到期日 (timeRange), 没填则回退到所属笔记的日期
/// (文件名 `YYYY-MM-DD` 优先, 否则 updatedAt)。否则任务永远挂不上日历。
function dueDateOf(t: MemoTodoEntry, memoDateById: Map<string, string>): string | null {
  const m = t.timeRange?.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return memoDateById.get(t.memoId) ?? null;
}

interface DayEvents {
  tasks: MemoTodoEntry[];
  memoIds: string[];
}

export function CalendarView({
  notebookId,
  onOpenMemo,
}: {
  notebookId?: string | null;
  onOpenMemo: (memoId: string) => void;
}) {
  const memos = useMemoStore((s) => s.memos);
  const [todos, setTodos] = useState<MemoTodoEntry[]>([]);
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<string | null>(() => toDateStr(Date.now()));

  useEffect(() => {
    let alive = true;
    memosClient
      .getTodoMetadata(notebookId, 'updatedAt')
      .then((t) => {
        if (alive) setTodos(t);
      })
      .catch(() => {
        /* 日历是辅助视图, 取数失败静默降级 */
      });
    return () => {
      alive = false;
    };
  }, [notebookId]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, DayEvents>();
    const push = (d: string, fn: (e: DayEvents) => void) => {
      const e = map.get(d) ?? { tasks: [], memoIds: [] };
      fn(e);
      map.set(d, e);
    };
    // 笔记日期: 文件名里的 `YYYY-MM-DD` 优先, 否则用最后更新日。
    const memoDateById = new Map<string, string>();
    memos.forEach((m) => {
      const fm = m.filename.match(/(\d{4}-\d{2}-\d{2})/);
      memoDateById.set(m.id, fm ? fm[1] : toDateStr(m.updatedAt));
    });
    todos.forEach((t) => {
      const d = dueDateOf(t, memoDateById);
      if (!d) return;
      push(d, (e) => {
        e.tasks.push(t);
        if (!e.memoIds.includes(t.memoId)) e.memoIds.push(t.memoId);
      });
    });
    // 笔记按日期落点, 让日历也能反映笔记活动。
    memos.forEach((m) => {
      const d = memoDateById.get(m.id)!;
      push(d, (e) => {
        if (!e.memoIds.includes(m.id)) e.memoIds.push(m.id);
      });
    });
    return map;
  }, [todos, memos]);

  const year = cursor.getFullYear();
  const monthIdx = cursor.getMonth();
  const firstWeekday = (new Date(year, monthIdx, 1).getDay() + 6) % 7; // 周一=0
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  while (cells.length < 42) cells.push(null);

  const monthLabel = `${year}年${monthIdx + 1}月`;
  const todayStr = toDateStr(Date.now());

  const selectedEvents = selected ? eventsByDay.get(selected) : undefined;
  // 待办任务: 未完成、按优先级降序, 一行一个 (待办与笔记是两套逻辑, 不按笔记聚合)。
  const selectedTasks = useMemo(() => {
    if (!selectedEvents) return [];
    return [...selectedEvents.tasks]
      .filter((t) => t.status !== 'completed')
      .sort((a, b) => prioRank(b.priority) - prioRank(a.priority));
  }, [selectedEvents]);
  // 纯笔记活动: 当天有笔记落点、但没有未完成任务对应的笔记, 单独显示一行 📝。
  const selectedMemoItems = useMemo(() => {
    if (!selectedEvents) return [];
    const taskMemoIds = new Set(
      selectedEvents.tasks.filter((t) => t.status !== 'completed').map((t) => t.memoId),
    );
    return memos.filter(
      (m) => selectedEvents.memoIds.includes(m.id) && !taskMemoIds.has(m.id),
    );
  }, [selectedEvents, memos]);

  const topPriorityColor = (ev?: DayEvents): string | undefined => {
    if (!ev) return undefined;
    const open = ev.tasks.filter((t) => t.status !== 'completed');
    // 有笔记的日子默认蓝点；若还有未完成的优先级任务，则按最高优先级上色。
    if (open.length === 0) return ev.memoIds.length > 0 ? '#3b82f6' : undefined;
    const top = [...open].sort((a, b) => prioRank(b.priority) - prioRank(a.priority))[0];
    return (PRIORITY_COLORS as Record<string, string>)[top.priority] ?? '#3b82f6';
  };


  const goMonth = (delta: number) => setCursor(new Date(year, monthIdx + delta, 1));

  return (
    <div className="flex h-full flex-col">
      {/* 月份导航 */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goMonth(-1)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            aria-label="上个月"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[72px] text-center text-sm font-medium text-[var(--foreground)]">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={() => goMonth(1)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            aria-label="下个月"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setCursor(new Date());
            setSelected(todayStr);
          }}
          className="rounded-md px-2 py-0.5 text-xs text-[var(--primary)] hover:bg-[var(--muted)]"
        >
          今天
        </button>
      </div>

      {/* 星期表头 */}
      <div className="grid grid-cols-7 border-b border-[var(--border)] text-center text-[11px] text-[var(--muted-foreground)]">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      {/* 月历网格 */}
      <div className="grid grid-cols-7 gap-px bg-[var(--border)]">
        {cells.map((d, i) => {
          if (d === null) return <div key={`empty-${i}`} className="bg-[var(--card)]" />;
          const ds = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const ev = eventsByDay.get(ds);
          const dotColor = topPriorityColor(ev);
          const isToday = ds === todayStr;
          const isSelected = ds === selected;
          return (
            <button
              key={ds}
              type="button"
              onClick={() => setSelected(ds)}
              className={cn(
                'flex min-h-[38px] flex-col items-center justify-start bg-[var(--card)] py-1 transition-colors',
                isSelected ? 'bg-[var(--muted)]' : 'hover:bg-[var(--muted)]/60',
              )}
            >
              <span
                className={cn(
                  'text-[12px] leading-none',
                  isToday ? 'font-bold text-[var(--primary)]' : 'text-[var(--foreground)]',
                )}
              >
                {d}
              </span>
              {dotColor && (
                <span className="mt-1 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dotColor }} />
              )}
            </button>
          );
        })}
      </div>

      {/* 选中当天的事项列表：待办按任务展开 (一行一个)，纯笔记活动另起一行 📝 */}
      <div className="mt-px flex-1 overflow-y-auto border-t border-[var(--border)] px-2 py-2">
        {!selectedEvents || (selectedTasks.length === 0 && selectedMemoItems.length === 0) ? (
          <p className="px-2 py-3 text-xs text-[var(--muted-foreground)]">这天没有安排</p>
        ) : (
          <div className="space-y-0.5">
            {/* 待办任务：一行一个，颜色取该任务优先级 */}
            {selectedTasks.map((t, i) => {
              const color = (PRIORITY_COLORS as Record<string, string>)[t.priority] ?? '#9ca3af';
              return (
                <button
                  key={`t-${t.memoId}-${i}`}
                  type="button"
                  onClick={() => onOpenMemo(t.memoId)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--muted)]"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--foreground)]">
                    {t.content}
                  </span>
                </button>
              );
            })}
            {/* 纯笔记活动：当天无未完成任务但有过笔记，显示笔记标题 */}
            {selectedMemoItems.map((m) => (
              <button
                key={`m-${m.id}`}
                type="button"
                onClick={() => onOpenMemo(m.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--muted)]"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: '#3b82f6' }}
                />
                <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--muted-foreground)]">
                  📝 {displayTitleFromFilename(m.filename)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
