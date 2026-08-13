// MemoItem 类型 — 独立文件, 供 types/memo.ts (MemoEvent 镜像) 和
// store/memo-store.ts 共享, 避免循环引用。
//
// 跟后端 `tank-core::memo_file::Memo` 镜像, 字段命名是 camelCase
// (后端走 `#[serde(rename_all = "camelCase")]` 跨 IPC 边界)。

export type MemoColor = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'gray';

export interface AgentThreadItem {
  threadId: string;
  title: string;
  // Agent Type key, kept separate from agentRole* persona fields.
  agentType: string;
}

/// 单条待办。与后端 `tank_core::memo_file::TodoItem` 镜像 (camelCase)。
/// 富字段由增强 checkbox 语法派生, 均为可选/可空, 兼容纯 `- [ ] x`。
export interface TodoItem {
  content: string;
  status: string;
  priority?: string;
  timeRange?: string;
  owner?: string;
  assignee?: string;
  reminder?: string;
  categoryId?: string;
  subTasks?: TodoItem[];
}

export interface MemoItem {
  id: string;
  filename: string;
  preview: string;
  thumbnail?: string | null;
  tags: string[];
  todos: TodoItem[];
  agents: AgentThreadItem[];
  createdAt: number;
  updatedAt: number;
  favorited: boolean;
  icon: string | null;
  colors: MemoColor[];
  properties: Record<string, unknown>;
  isOpen?: boolean;
}
