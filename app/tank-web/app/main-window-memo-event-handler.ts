import type { MemoEvent } from '@/types/memo';
import type { MemoItem } from '@/types/memo-item';

export interface MainWindowMemoEventActions {
  getSelectedNotebookId: () => string | null;
  invalidateMentionCaches: () => void;
  openNoteTab: (memoId: string) => Promise<void>;
  isMemoOpenInCurrentWindow: (memoId: string) => boolean;
  reportOpenFailure: (error: unknown) => void;
  handleMemoCreated: (memo: MemoItem) => void;
  handleMemoUpdated: (memo: MemoItem) => void;
  handleMemoDeleted: (memoId: string) => void;
  handleTagsRenamed: (event: Extract<MemoEvent, { kind: 'tags_renamed' }>) => void;
  handleTagsDeleted: (event: Extract<MemoEvent, { kind: 'tags_deleted' }>) => void;
  replaceActiveMemoPath: (memoId: string, path: string) => void;
  refreshSelectedNotebookMetadata: (event: MemoEvent) => void;
  refreshBackgroundTodoCount: (notebookId: string) => void;
}

/**
 * Route one memo event inside the main Webview.
 *
 * Externally created notes always open. Application-created notes also open
 * when they belong to a known background notebook, because the selected list
 * cannot present them. List and tag metadata updates remain scoped to the
 * selected notebook, while notebook-keyed todo counts refresh in background.
 *
 * `tags_renamed` / `tags_deleted` 都是 tag 子树操作的收口事件, 后端已经
 * 完成所有 affected memo 的 body 改写 + index 同步。 这里只走
 * `handleTagsRenamed` / `handleTagsDeleted` 局部 patch memos 数组的 .tags
 * 字段, **不再**走 handleMemoUpdated / refreshSelectedNotebookMetadata ──
 * 后者会触发 triggerRefresh / loadData / loadMemos 重拉, 让"重命名 / 删除
 * tag 时无关列表闪烁"再次发生。
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

  actions.invalidateMentionCaches();

  const selectedNotebookId = actions.getSelectedNotebookId();
  const shouldOpenCreatedNote = event.kind === 'created' && (
    event.source === 'external_tool'
    || (!!selectedNotebookId && selectedNotebookId !== event.notebookId)
  );
  if (shouldOpenCreatedNote) {
    // 当前 webview 已经在编辑这篇 → 不再弹新窗口。否则同一篇会同时开在
    // 「主窗口编辑器」和「自动弹出的 tab 窗口」两份, 两边各自的 save-queue
    // 用不同的 CAS 基线互相拒绝, 报"同步错误"。已存在则聚焦: 主窗口本就
    // 在显示它; 若开在别的窗口, Rust route_tab 的 find_tab 会聚焦那个窗口。
    if (!actions.isMemoOpenInCurrentWindow(event.memo.id)) {
      void actions.openNoteTab(event.memo.id).catch(actions.reportOpenFailure);
    }
  }

  if (!selectedNotebookId || selectedNotebookId !== event.notebookId) {
    if (event.derivedChanged.todos) {
      actions.refreshBackgroundTodoCount(event.notebookId);
    }
    return;
  }

  // 自己正在编辑的 memo 被快打字 autosave 误标成 external_tool 时, 不重拉
  // 列表元数据 (tags / todo count), 避免列表频繁闪烁 —— 内容已由
  // handleMemoUpdated 就地更新。这是 self-write 抑制的前端等价 (后端
  // watcher 的 self_write 表只覆盖外部 Markdown 文件, 不覆盖内部 memo)。
  const isSelfEditedUpdate =
    event.kind === 'updated'
    && event.source === 'external_tool'
    && actions.isMemoOpenInCurrentWindow(event.id);

  if (event.kind === 'created') {
    actions.handleMemoCreated(event.memo);
  } else if (event.kind === 'updated') {
    actions.handleMemoUpdated(event.memo);
    actions.replaceActiveMemoPath(event.id, event.path);
  } else {
    actions.handleMemoDeleted(event.id);
  }

  if (!isSelfEditedUpdate) {
    actions.refreshSelectedNotebookMetadata(event);
  }
}
