import { memos } from '@platform/tauri/client';
import { useMemoStore, type Notebook } from '@features/memo';
import { openMemoSession } from '@features/memo/components/open-memo-session';
import { BUILT_IN_BY_SLUG, QUICK_TODO_SLUG } from '@features/memo/data/built-in-templates';
import { toast } from '@/lib/toast';

/**
 * 快速新增一条待办。
 *
 * 复用「从模板创建」这条已验证的路径：先确保内置「待办」模板存在（用户可能删过，
 * 模板中心不一定打开过），再从其创建笔记并打开。新建笔记正文为 `- [ ] `，
 * 用户直接在编辑器里输入任务文字即可，并会自动出现在「待办视图」。
 *
 * 「把笔记内容直接转成待办」由编辑器气泡菜单的「设为待办」按钮负责，本条只做
 * 「凭空快速新增」这一入口。
 */
export async function createQuickTodo(notebook: Notebook | null): Promise<void> {
  if (!notebook) {
    toast.error('请先选择一个笔记本');
    return;
  }
  const builtIn = BUILT_IN_BY_SLUG.get(QUICK_TODO_SLUG);
  if (!builtIn) return;

  try {
    const existing = await memos.listTemplates();
    let tpl = existing.find((t) => t.name === builtIn.name);
    if (!tpl) {
      tpl = await memos.saveTemplate(builtIn.name, builtIn.content);
    }

    const memo = await memos.createFromTemplate(tpl.id, notebook.id);
    useMemoStore.getState().handleMemoCreated(memo, { select: true });
    await openMemoSession(memo, notebook);
  } catch (err) {
    toast.error(`新增待办失败：${String(err)}`);
  }
}
