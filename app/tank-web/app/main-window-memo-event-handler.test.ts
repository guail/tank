import { describe, expect, it, vi } from 'vitest';

import {
  handleMainWindowMemoEvent,
  type MainWindowMemoEventActions,
} from './main-window-memo-event-handler';
import type { MemoEvent } from '@/types/memo';
import type { MemoItem } from '@/types/memo-item';

const memo: MemoItem = {
  id: 'memo-b',
  filename: 'Created.md',
  preview: '',
  tags: [],
  todos: [],
  agents: [],
  createdAt: 1,
  updatedAt: 1,
  favorited: false,
  icon: null,
  colors: [],
  properties: {},
};

function createActions(selectedNotebookId = 'notebook-a'): MainWindowMemoEventActions {
  return {
    getSelectedNotebookId: vi.fn(() => selectedNotebookId),
    invalidateMentionCaches: vi.fn(),
    handleTagsRenamed: vi.fn(),
    handleTagsDeleted: vi.fn(),
    refreshBackgroundTodoCount: vi.fn(),
  };
}

function createMemoEvent(kind: 'created' | 'updated' | 'deleted', source: string): MemoEvent {
  if (kind === 'created') {
    return {
      kind: 'created',
      memo,
      notebookId: 'notebook-b',
      derivedChanged: { tags: false, todos: true, agents: false },
      source: source as MemoEvent & { kind: 'created' } extends { source: infer S } ? S : never,
    };
  }
  if (kind === 'updated') {
    return {
      kind: 'updated',
      id: memo.id,
      path: '/notebook-b/Renamed.md',
      memo: { ...memo, filename: 'Renamed.md' },
      notebookId: 'notebook-b',
      derivedChanged: { tags: false, todos: false, agents: false },
      source: source as MemoEvent & { kind: 'updated' } extends { source: infer S } ? S : never,
    };
  }
  return {
    kind: 'deleted',
    id: memo.id,
    path: '/notebook-b/Created.md',
    notebookId: 'notebook-b',
    derivedChanged: { tags: false, todos: false, agents: false },
    source: source as MemoEvent & { kind: 'deleted' } extends { source: infer S } ? S : never,
  };
}

describe('handleMainWindowMemoEvent', () => {
  it('does not auto-open or update UI for created events', () => {
    const actions = createActions('notebook-a');

    handleMainWindowMemoEvent(createMemoEvent('created', 'external_tool'), actions);

    expect(actions.handleTagsRenamed).not.toHaveBeenCalled();
    expect(actions.handleTagsDeleted).not.toHaveBeenCalled();
    expect(actions.refreshBackgroundTodoCount).toHaveBeenCalledWith('notebook-b');
    expect(actions.invalidateMentionCaches).toHaveBeenCalledOnce();
  });

  it('does not update UI for updated events', () => {
    const actions = createActions('notebook-b');

    handleMainWindowMemoEvent(createMemoEvent('updated', 'external_tool'), actions);

    expect(actions.handleTagsRenamed).not.toHaveBeenCalled();
    expect(actions.handleTagsDeleted).not.toHaveBeenCalled();
    expect(actions.refreshBackgroundTodoCount).not.toHaveBeenCalled();
    expect(actions.invalidateMentionCaches).toHaveBeenCalledOnce();
  });

  it('does not update UI for deleted events', () => {
    const actions = createActions('notebook-b');

    handleMainWindowMemoEvent(createMemoEvent('deleted', 'external_tool'), actions);

    expect(actions.handleTagsRenamed).not.toHaveBeenCalled();
    expect(actions.handleTagsDeleted).not.toHaveBeenCalled();
    expect(actions.refreshBackgroundTodoCount).not.toHaveBeenCalled();
    expect(actions.invalidateMentionCaches).toHaveBeenCalledOnce();
  });

  it('routes tags_renamed to handleTagsRenamed and bypasses memo/replace/refresh paths', () => {
    const actions = createActions('notebook-b');
    const event: MemoEvent = {
      kind: 'tags_renamed',
      notebookId: 'notebook-b',
      renamedTags: [['中国', '华']],
      affectedMemoIds: ['memo-1', 'memo-2'],
    };

    handleMainWindowMemoEvent(event, actions);

    expect(actions.handleTagsRenamed).toHaveBeenCalledWith(event);
    expect(actions.handleTagsDeleted).not.toHaveBeenCalled();
    expect(actions.refreshBackgroundTodoCount).not.toHaveBeenCalled();
    expect(actions.invalidateMentionCaches).toHaveBeenCalledOnce();
  });

  it('routes tags_renamed to handleTagsRenamed even for background notebooks', () => {
    const actions = createActions('notebook-a');
    const event: MemoEvent = {
      kind: 'tags_renamed',
      notebookId: 'notebook-b',
      renamedTags: [],
      affectedMemoIds: [],
    };

    handleMainWindowMemoEvent(event, actions);

    expect(actions.handleTagsRenamed).toHaveBeenCalledWith(event);
    expect(actions.refreshBackgroundTodoCount).not.toHaveBeenCalled();
    expect(actions.invalidateMentionCaches).toHaveBeenCalledOnce();
  });

  it('routes tags_deleted to handleTagsDeleted and bypasses memo/replace/refresh paths', () => {
    const actions = createActions('notebook-b');
    const event: MemoEvent = {
      kind: 'tags_deleted',
      notebookId: 'notebook-b',
      deletedTags: ['中国', '中国/湖南'],
      affectedMemoIds: ['memo-1'],
    };

    handleMainWindowMemoEvent(event, actions);

    expect(actions.handleTagsDeleted).toHaveBeenCalledWith(event);
    expect(actions.handleTagsRenamed).not.toHaveBeenCalled();
    expect(actions.refreshBackgroundTodoCount).not.toHaveBeenCalled();
    expect(actions.invalidateMentionCaches).toHaveBeenCalledOnce();
  });

  it('routes tags_deleted to handleTagsDeleted even for background notebooks', () => {
    const actions = createActions('notebook-a');
    const event: MemoEvent = {
      kind: 'tags_deleted',
      notebookId: 'notebook-b',
      deletedTags: [],
      affectedMemoIds: [],
    };

    handleMainWindowMemoEvent(event, actions);

    expect(actions.handleTagsDeleted).toHaveBeenCalledWith(event);
    expect(actions.refreshBackgroundTodoCount).not.toHaveBeenCalled();
    expect(actions.invalidateMentionCaches).toHaveBeenCalledOnce();
  });
});
