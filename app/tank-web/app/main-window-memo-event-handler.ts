import type { MemoEvent } from '@/types/memo';

export interface MainWindowMemoEventActions {
  getSelectedNotebookId: () => string | null;
  invalidateMentionCaches: () => void;
  handleTagsRenamed: (event: Extract<MemoEvent, { kind: 'tags_renamed' }>) => void;
  handleTagsDeleted: (event: Extract<MemoEvent, { kind: 'tags_deleted' }>) => void;
  refreshBackgroundTodoCount: (notebookId: string) => void;
}

/**
 * Route one memo event inside the main Webview.
 *
 * 2026-08-11: watcher 驱动的 created/updated/deleted 事件**不再**自动打开
 * 新窗口、替换当前文档或刷新列表。快打字时 autosave echo 被误识别为外
 * 部修改，导致弹窗与"文档已被外部修改"错误；用户要求直接删掉这部分自
 * 动功能。列表内容改为在用户手动切回/刷新时更新。
 *
 * 仅保留 tags_renamed / tags_deleted 的处理（用户主动触发的标签子树
 * 操作），以及后台 notebook 的 todo 计数刷新。
 */
export function handleMainWindowMemoEvent(
  event: MemoEvent,
  actions: MainWindowMemoEventActions,
): void {
  // tags_renamed / tags_deleted 不是单条 memo 写入事件, 走独立分支: 局
  // 部 patch memos 数组, 不替换 memo 整体, 不走 triggerMetadataRefresh
  // / loadData。 notebookId 失配也照样 patch (背景 notebook 的 memos 也
  // 得跟着重写, 否则用户切回时看到 stale tag token)。
  if (event.kind === 'tags_renamed') {
    actions.invalidateMentionCaches();
    actions.handleTagsRenamed(event);
    return;
  }
  if (event.kind === 'tags_deleted') {
    actions.invalidateMentionCaches();
    actions.handleTagsDeleted(event);
    return;
  }

  // created / updated / deleted 现在只做最轻量的副作用:
  // - 清掉 mention 缓存, 避免 stale 补全
  // - 若事件来自后台 notebook 且 todo 计数可能变化, 刷新该 notebook 的
  //   todo 计数 (不触发列表内容重拉)
  actions.invalidateMentionCaches();

  const selectedNotebookId = actions.getSelectedNotebookId();
  if (!selectedNotebookId || selectedNotebookId !== event.notebookId) {
    if (event.derivedChanged.todos) {
      actions.refreshBackgroundTodoCount(event.notebookId);
    }
  }
}
