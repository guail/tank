// 任务富字段的解析 / 序列化 (与 tank-core/src/memo_file/derivation.rs 的 marker 语法一一对应)。
// 数据真相在 markdown 文本的 marker 里, 这里负责前端读写它们。

export type Priority = '' | 'high' | 'medium' | 'low' | 'none';

export interface TaskFields {
  priority: Priority;
  /** 截止日期, 自由文本 (如 2026-08-20 / 周五) */
  due: string;
  /** 提醒时间, 自由文本 (如 09:00) */
  reminder: string;
  /** 分类标签 */
  category: string;
  /** 收件箱处置: 空=可行动, waiting=等待他人, someday=将来也许 */
  disposition: '' | 'waiting' | 'someday';
  /** disposition=waiting 时记录等谁 */
  waitingFor: string;
}

// 与 derivation.rs 的正则保持同步
const PRIORITY_RE = /\[!(high|medium|med|low|none)\]/i;
const DUE_RE = /\[📅([^\]]+)\]|\[due:([^\]]+)\]/i;
const REMIND_RE = /\[⏰([^\]]+)\]|\[remind:([^\]]+)\]/i;
const CAT_RE = /\[🏷([^\]]+)\]|\[cat:([^\]]+)\]/i;
const WAIT_RE = /\[(?:wait|waiting):([^\]]+)\]/i;
const SOMEDAY_RE = /\[(?:someday|maybe)\]/i;

function group1or2(m: RegExpMatchArray | null): string {
  if (!m) return '';
  return (m[1] ?? m[2] ?? '').trim();
}

export function parseTaskFields(text: string): TaskFields {
  const rawPrio = group1or2(text.match(PRIORITY_RE)).toLowerCase();
  const priority: Priority = (rawPrio === 'med' ? 'medium' : rawPrio) as Priority;
  const due = group1or2(text.match(DUE_RE));
  const reminder = group1or2(text.match(REMIND_RE));
  const category = group1or2(text.match(CAT_RE));
  const waitingMatch = text.match(WAIT_RE);
  const someday = SOMEDAY_RE.test(text);
  const disposition: TaskFields['disposition'] = waitingMatch ? 'waiting' : someday ? 'someday' : '';
  const waitingFor = waitingMatch ? waitingMatch[1].trim() : '';
  return { priority, due, reminder, category, disposition, waitingFor };
}

/** 去掉文本里所有已知 marker, 返回干净的的任务正文。 */
export function stripTaskMarkers(text: string): string {
  return text
    .replace(PRIORITY_RE, '')
    .replace(DUE_RE, '')
    .replace(REMIND_RE, '')
    .replace(CAT_RE, '')
    .replace(WAIT_RE, '')
    .replace(SOMEDAY_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 由字段生成规范化的 marker 前缀。 */
export function serializeTaskMarkers(f: TaskFields): string {
  const parts: string[] = [];
  if (f.priority && f.priority !== 'none') parts.push(`[!${f.priority}]`);
  if (f.due) parts.push(`[📅${f.due}]`);
  if (f.reminder) parts.push(`[⏰${f.reminder}]`);
  if (f.category) parts.push(`[🏷${f.category}]`);
  if (f.disposition === 'waiting') parts.push(`[wait:${f.waitingFor || '某人'}]`);
  if (f.disposition === 'someday') parts.push(`[someday]`);
  return parts.join(' ');
}

/** 给定任务全文, 返回把 marker 替换为规范集合后的新文本。 */
export function applyTaskFields(fullText: string, f: TaskFields): string {
  const body = stripTaskMarkers(fullText);
  const markers = serializeTaskMarkers(f);
  return markers ? `${markers} ${body}` : body;
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  '': '无',
  none: '无',
  low: '低',
  medium: '中',
  high: '高',
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  '': '#9ca3af',
  none: '#9ca3af',
  low: '#3b82f6',
  medium: '#f59e0b',
  high: '#ef4444',
};
