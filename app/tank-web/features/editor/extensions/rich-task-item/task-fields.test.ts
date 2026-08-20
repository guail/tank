import { describe, expect, it } from 'vitest';
import {
  applyTaskFields,
  parseTaskFields,
  serializeTaskMarkers,
  stripTaskMarkers,
} from './task-fields';

describe('parseTaskFields', () => {
  it('解析优先级', () => {
    expect(parseTaskFields('[!high] 买牛奶').priority).toBe('high');
    expect(parseTaskFields('[!medium] 中').priority).toBe('medium');
    expect(parseTaskFields('普通任务').priority).toBe('');
  });

  it('med 归一化为 medium', () => {
    expect(parseTaskFields('[!med] x').priority).toBe('medium');
  });

  it('解析截止 / 提醒 (emoji 与 due:/remind: 两种写法)', () => {
    const a = parseTaskFields('[📅2026-08-20] [⏰09:00] 开会');
    expect(a.due).toBe('2026-08-20');
    expect(a.reminder).toBe('09:00');
    const b = parseTaskFields('[due:fri] [remind:18:00] 跑步');
    expect(b.due).toBe('fri');
    expect(b.reminder).toBe('18:00');
  });

  it('解析截止支持 🗓 / 🗓️ 变体', () => {
    expect(parseTaskFields('[🗓2026-08-21] 物业费').due).toBe('2026-08-21');
    expect(parseTaskFields('[🗓️2026-08-22] 电费').due).toBe('2026-08-22');
  });

  it('解析分类', () => {
    expect(parseTaskFields('[🏷work] 写报告').category).toBe('work');
    expect(parseTaskFields('[cat:home] 洗碗').category).toBe('home');
  });

  it('解析等待 / 将来处置', () => {
    const w = parseTaskFields('[wait:Alice] 等审批');
    expect(w.disposition).toBe('waiting');
    expect(w.waitingFor).toBe('Alice');
    const s = parseTaskFields('[someday] 学吉他');
    expect(s.disposition).toBe('someday');
    const m = parseTaskFields('[maybe] 旅行');
    expect(m.disposition).toBe('someday');
  });
});

describe('stripTaskMarkers', () => {
  it('剥离所有 marker, 保留正文', () => {
    expect(stripTaskMarkers('[!high] [📅fri] [⏰09:00] [🏷work] [wait:Alice] 买牛奶')).toBe('买牛奶');
    expect(stripTaskMarkers('普通任务')).toBe('普通任务');
  });
});

describe('applyTaskFields 往返', () => {
  it('改写优先级并保留正文', () => {
    const fields = parseTaskFields('[!high] 买牛奶');
    fields.priority = 'low';
    fields.due = 'fri';
    expect(applyTaskFields('[!high] 买牛奶', fields)).toBe('[!low] [📅fri] 买牛奶');
  });

  it('切换到等待处置会写入 wait:', () => {
    const fields = parseTaskFields('买牛奶');
    fields.disposition = 'waiting';
    fields.waitingFor = 'Bob';
    expect(applyTaskFields('买牛奶', fields)).toBe('[wait:Bob] 买牛奶');
  });

  it('切换到将来会写入 someday', () => {
    const fields = parseTaskFields('买牛奶');
    fields.disposition = 'someday';
    expect(applyTaskFields('买牛奶', fields)).toBe('[someday] 买牛奶');
  });

  it('从等待切回可行动会移除 wait:', () => {
    const fields = parseTaskFields('[wait:Alice] 等审批');
    fields.disposition = '';
    fields.waitingFor = '';
    expect(applyTaskFields('[wait:Alice] 等审批', fields)).toBe('等审批');
  });

  it('serializeTaskMarkers 规范化顺序', () => {
    expect(
      serializeTaskMarkers({
        priority: 'high',
        due: 'fri',
        reminder: '09:00',
        category: 'work',
        disposition: '',
        waitingFor: '',
      }),
    ).toBe('[!high] [📅fri] [⏰09:00] [🏷work]');
  });
});
