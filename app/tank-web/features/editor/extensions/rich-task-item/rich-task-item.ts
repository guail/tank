// 富任务 NodeView: 在编辑器内为每条 task item 渲染优先级/截止/提醒/分类/处置徽章,
// 并提供就地编辑弹层改写 marker 语法 (与 tank-core 解析器一致)。
//
// 复刻自 @tiptap/extension-list 的默认 TaskItem NodeView (checkbox 勾选行为),
// 在其基础上追加 badges + 编辑入口。徽章/弹层位于 contentDOM 之外, 不参与序列化。

import { TaskItem } from '@tiptap/extension-task-item';
import {
  getRenderedAttributes,
  renderNestedMarkdownContent,
  type JSONContent,
  type MarkdownRendererHelpers,
  type NodeViewRendererProps,
} from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import {
  applyTaskFields,
  parseTaskFields,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  type TaskFields,
} from './task-fields';

// 任务拖拽排序: 同一编辑器内跨 taskItem 重排 (仅允许同层)。
// 拖拽发生在多个 NodeView 实例之间, 用模块级变量共享当前拖拽源。
let dragSrcPos: number | null = null;
let dragSrcDepth = 0;

const EMPTY_PARAGRAPH_MARKDOWN = '&nbsp;';

const isEmptyParagraphNode = (n: JSONContent | undefined): boolean =>
  !!n && n.type === 'paragraph' && (!n.content || n.content.length === 0);

// 复刻 PreservedTaskItem 的 renderMarkdown (保留空段落占位标记)
function renderMarkdown(node: JSONContent, h: MarkdownRendererHelpers): string {
  const checkedChar = node.attrs?.checked ? 'x' : ' ';
  const prefix = `- [${checkedChar}] `;
  const first = node.content?.[0];

  if (first && !isEmptyParagraphNode(first)) {
    return renderNestedMarkdownContent(node, h, prefix);
  }

  const children = node.content ?? [];
  const nestedContent = children.slice(1);
  let output =
    nestedContent.length === 0 ? `${prefix}${EMPTY_PARAGRAPH_MARKDOWN}` : prefix;

  nestedContent.forEach((child, index) => {
    const childContent =
      h.renderChild?.(child, index + 1) ?? h.renderChildren([child]);
    if (childContent === undefined || childContent === null) return;

    const indentedChild = childContent
      .split('\n')
      .map((line: string) => h.indent(line || ''))
      .join('\n');

    output += child.type === 'paragraph' ? `\n\n${indentedChild}` : `\n${indentedChild}`;
  });

  return output;
}

const BADGE_STYLE =
  'display:inline-flex;align-items:center;gap:3px;font-size:11px;line-height:16px;' +
  'padding:0 6px;border-radius:999px;margin-left:6px;vertical-align:middle;white-space:nowrap;';

function makeBadge(label: string, color: string, bg: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'rich-task-badge';
  el.style.cssText = BADGE_STYLE + `color:${color};background:${bg};`;
  el.textContent = label;
  return el;
}

function renderBadges(fields: TaskFields): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'rich-task-badges';
  wrap.style.cssText = 'display:inline-flex;flex-wrap:wrap;align-items:center;';

  if (fields.priority && fields.priority !== 'none') {
    const c = PRIORITY_COLORS[fields.priority];
    wrap.appendChild(makeBadge(`优先级·${PRIORITY_LABELS[fields.priority]}`, '#fff', c));
  }
  if (fields.due) {
    wrap.appendChild(makeBadge(`📅 ${fields.due}`, '#1f2937', '#e5e7eb'));
  }
  if (fields.reminder) {
    wrap.appendChild(makeBadge(`⏰ ${fields.reminder}`, '#1f2937', '#e5e7eb'));
  }
  if (fields.category) {
    wrap.appendChild(makeBadge(`🏷 ${fields.category}`, '#fff', '#6366f1'));
  }
  if (fields.disposition === 'waiting') {
    wrap.appendChild(makeBadge(`等待·${fields.waitingFor || '某人'}`, '#fff', '#0ea5e9'));
  }
  if (fields.disposition === 'someday') {
    wrap.appendChild(makeBadge('将来也许', '#fff', '#8b5cf6'));
  }
  return wrap;
}

const POPOVER_STYLE =
  'position:fixed;z-index:2147483620;margin-top:4px;min-width:240px;' +
  'background:#fff;color:#111;border:1px solid #e5e7eb;border-radius:10px;' +
  'box-shadow:0 8px 24px rgba(0,0,0,.18);padding:12px;font-size:13px;';

function buildPopover(
  initial: TaskFields,
  onSave: (f: TaskFields) => void,
  onClose: () => void,
): HTMLElement {
  const pop = document.createElement('div');
  pop.className = 'rich-task-popover';
  pop.style.cssText = POPOVER_STYLE;

  let fields: TaskFields = { ...initial };

  const rowStyle =
    'display:flex;align-items:center;justify-content:space-between;margin:8px 0;gap:8px;';
  const labelStyle = 'color:#6b7280;';
  const inputStyle =
    'border:1px solid #d1d5db;border-radius:6px;padding:4px 6px;font-size:13px;min-width:120px;';

  const select = (opts: { value: string; label: string }[], value: string): HTMLSelectElement => {
    const s = document.createElement('select');
    s.style.cssText = inputStyle;
    opts.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === value) opt.selected = true;
      s.appendChild(opt);
    });
    return s;
  };
  const textInput = (value: string, placeholder: string): HTMLInputElement => {
    const i = document.createElement('input');
    i.type = 'text';
    i.value = value;
    i.placeholder = placeholder;
    i.style.cssText = inputStyle;
    return i;
  };
  const dateInput = (value: string): HTMLInputElement => {
    const i = document.createElement('input');
    i.type = 'date';
    i.value = value;
    i.style.cssText = inputStyle;
    return i;
  };
  const timeInput = (value: string): HTMLInputElement => {
    const i = document.createElement('input');
    i.type = 'time';
    // 提醒字段可能是 "09:00" / "fri 09:00" 等，只有纯 HH:MM 才能直接回填到 time input。
    const timeValue = /^\d{2}:\d{2}$/.test(value) ? value : '';
    i.value = timeValue;
    i.style.cssText = inputStyle;
    return i;
  };

  const prioSel = select(
    [
      { value: '', label: '无' },
      { value: 'high', label: '高' },
      { value: 'medium', label: '中' },
      { value: 'low', label: '低' },
    ],
    fields.priority,
  );
  const dispSel = select(
    [
      { value: '', label: '可行动' },
      { value: 'waiting', label: '等待他人' },
      { value: 'someday', label: '将来也许' },
    ],
    fields.disposition,
  );
  const waitInput = textInput(fields.waitingFor, '等谁, 如 Alice');
  const dueInput = dateInput(fields.due);
  const remindInput = timeInput(fields.reminder);
  const catInput = textInput(fields.category, '如 work');

  const syncWaiting = () => {
    waitInput.style.display = fields.disposition === 'waiting' ? '' : 'none';
  };
  syncWaiting();

  prioSel.onchange = () => (fields.priority = prioSel.value as TaskFields['priority']);
  dispSel.onchange = () => {
    fields.disposition = dispSel.value as TaskFields['disposition'];
    syncWaiting();
  };
  waitInput.oninput = () => (fields.waitingFor = waitInput.value);
  dueInput.onchange = () => (fields.due = dueInput.value);
  remindInput.onchange = () => (fields.reminder = remindInput.value);
  catInput.oninput = () => (fields.category = catInput.value);

  const addRow = (labelText: string, control: HTMLElement) => {
    const row = document.createElement('div');
    row.style.cssText = rowStyle;
    const l = document.createElement('span');
    l.textContent = labelText;
    l.style.cssText = labelStyle;
    row.append(l, control);
    pop.appendChild(row);
  };
  addRow('优先级', prioSel);
  addRow('处置', dispSel);
  addRow('等待对象', waitInput);
  addRow('截止', dueInput);
  addRow('提醒', remindInput);
  addRow('分类', catInput);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:10px;';
  const cancel = document.createElement('button');
  cancel.textContent = '取消';
  cancel.style.cssText =
    'border:1px solid #d1d5db;border-radius:6px;padding:4px 12px;cursor:pointer;background:#fff;';
  cancel.onclick = () => onClose();
  const save = document.createElement('button');
  save.textContent = '保存';
  save.style.cssText =
    'border:none;border-radius:6px;padding:4px 12px;cursor:pointer;background:#2563eb;color:#fff;';
  save.onclick = () => {
    onSave(fields);
    onClose();
  };
  btnRow.append(cancel, save);
  pop.appendChild(btnRow);
  return pop;
}

export const RichTaskItem = TaskItem.extend({
  renderMarkdown,
  addNodeView() {
    return (props: NodeViewRendererProps): NodeView => {
      const { node, HTMLAttributes, getPos, editor } = props;
      const listItem = document.createElement('li');
      const checkboxWrapper = document.createElement('label');
      const checkboxStyler = document.createElement('span');
      const checkbox = document.createElement('input');
      const content = document.createElement('div');

      const updateA11Y = (currentNode: PMNode) => {
        checkbox.ariaLabel = `Task item checkbox for ${currentNode.textContent || 'empty task item'}`;
      };
      updateA11Y(node);
      checkboxWrapper.contentEditable = 'false';
      checkbox.type = 'checkbox';
      checkbox.addEventListener('mousedown', (event) => event.preventDefault());
      checkbox.addEventListener('change', (event: Event) => {
        const target = event.target as HTMLInputElement;
        if (!editor.isEditable) {
          checkbox.checked = !checkbox.checked;
          return;
        }
        const { checked } = target;
        if (typeof getPos === 'function') {
          editor
            .chain()
            .focus(void 0, { scrollIntoView: false })
            .command(({ tr }) => {
              const position = getPos();
              if (typeof position !== 'number') return false;
              const currentNode = tr.doc.nodeAt(position);
              tr.setNodeMarkup(position, void 0, {
                ...(currentNode as PMNode | null)?.attrs,
                checked,
              });
              return true;
            })
            .run();
        }
      });

      const staticAttrs = this.options.HTMLAttributes ?? {};
      Object.entries(staticAttrs).forEach(([key, value]) =>
        listItem.setAttribute(key, value as string),
      );
      listItem.dataset.checked = String(node.attrs.checked);
      listItem.style.position = 'relative';
      checkbox.checked = node.attrs.checked;

      // ---- 拖拽手柄 (grip): 置于 checkbox 前, 仅作排序拖拽, 不参与编辑 ----
      const grip = document.createElement('span');
      grip.className = 'rich-task-grip';
      grip.contentEditable = 'false';
      grip.setAttribute('draggable', 'true');
      grip.textContent = '⠿';
      grip.title = '拖动以重新排序任务';
      grip.style.cssText =
        'cursor:grab;opacity:.35;margin-right:4px;user-select:none;-webkit-user-select:none;transition:opacity .12s;';
      grip.addEventListener('mouseenter', () => (grip.style.opacity = '1'));
      grip.addEventListener('mouseleave', () => (grip.style.opacity = '.35'));
      // 阻止 grip 上的 mousedown 冒泡到编辑器, 避免抢占光标/选中。
      grip.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      checkboxWrapper.append(grip, checkbox, checkboxStyler);
      listItem.append(checkboxWrapper, content);

      Object.entries(HTMLAttributes).forEach(([key, value]) =>
        listItem.setAttribute(key, value as string),
      );

      // ---- 富字段徽章 + 编辑入口 (contentDOM 之外) ----
      const badgesEl = document.createElement('span');

      const editWrap = document.createElement('span');
      editWrap.style.cssText = 'position:relative;display:inline-block;';

      const editBtn = document.createElement('span');
      editBtn.className = 'rich-task-edit-btn';
      editBtn.contentEditable = 'false';
      editBtn.setAttribute('role', 'button');
      editBtn.tabIndex = -1;
      editBtn.textContent = '⚙';
      editBtn.title = '编辑任务字段';
      editBtn.style.cssText =
        'border:none;background:transparent;cursor:pointer;font-size:20px;margin-left:6px;opacity:.5;user-select:none;-webkit-user-select:none;';
      editBtn.addEventListener('mouseenter', () => (editBtn.style.opacity = '1'));
      editBtn.addEventListener('mouseleave', () => (editBtn.style.opacity = '.5'));

      let popoverEl: HTMLElement | null = null;
      let outsideHandler: ((e: MouseEvent) => void) | null = null;
      const closePopover = () => {
        if (popoverEl) {
          popoverEl.remove();
          popoverEl = null;
        }
        if (outsideHandler) {
          document.removeEventListener('mousedown', outsideHandler);
          outsideHandler = null;
        }
      };
      const onGearActivate = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        if (popoverEl) {
          closePopover();
          return;
        }
        const current = parseTaskFields(currentNode.textContent || '');
        popoverEl = buildPopover(
          current,
          (f) => {
            const pos = typeof getPos === 'function' ? getPos() : null;
            if (typeof pos !== 'number') return;
            const itemNode = editor.state.doc.nodeAt(pos);
            const paragraph = itemNode?.firstChild;
            if (!paragraph) return;
            const textStart = pos + 1 + 1;
            const textEnd = textStart + paragraph.content.size;
            const fullText = paragraph.textContent || '';
            const newText = applyTaskFields(fullText, f);
            const tr = editor.state.tr.insertText(newText, textStart, textEnd);
            editor.view.dispatch(tr);
          },
          closePopover,
        );
        // portal: 挂到 body + fixed 定位, 彻底绕开编辑器 overflow/行高裁剪
        document.body.appendChild(popoverEl);
        const rect = editBtn.getBoundingClientRect();
        const popW = popoverEl.offsetWidth || 240;
        let left = rect.left;
        if (left + popW > window.innerWidth - 8) {
          left = Math.max(8, window.innerWidth - popW - 8);
        }
        popoverEl.style.top = `${rect.bottom + 4}px`;
        popoverEl.style.left = `${left}px`;
        // eslint-disable-next-line no-console
        console.log('[RichTaskItem] popover opened', { top: rect.bottom + 4, left });
        outsideHandler = (ev: MouseEvent) => {
          if (popoverEl && !popoverEl.contains(ev.target as Node) && ev.target !== editBtn) {
            closePopover();
          }
        };
        // 延迟到下一 tick 绑定, 避免本次 mousedown 立即触发关闭
        setTimeout(
          () => outsideHandler && document.addEventListener('mousedown', outsideHandler),
          0,
        );
      };
      // 仅用 mousedown 触发: 在 contenteditable 内先于编辑器的 focus 处理, 最可靠。
      // 不要同时绑 click —— 同一物理点击会先 mousedown 打开、再 click 关闭, 造成"闪一下"。
      editBtn.addEventListener('mousedown', onGearActivate);

      editWrap.appendChild(editBtn);

      // 始终指向"最新节点": 文档更新后 ProseMirror 会传新的 updatedNode,
      // 但闭包里捕获的 node 仍是创建时的旧实例, 直接读它会拿到陈旧文本。
      let currentNode: PMNode = node;

      // ---- 拖拽排序: 同源 taskItem 在同一 taskList 内重排 ----
      const onDragStart = (e: DragEvent) => {
        if (!e.dataTransfer) return;
        const pos = typeof getPos === 'function' ? getPos() : getPos;
        if (typeof pos !== 'number') return;
        const $s = editor.state.doc.resolve(pos);
        let d = $s.depth;
        while (d > 0 && $s.node(d).type.name !== 'taskItem') d--;
        dragSrcPos = pos;
        dragSrcDepth = d;
        e.dataTransfer.setData('text/plain', String(pos));
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation();
      };
      const onDragOver = (e: DragEvent) => {
        if (dragSrcPos !== null && e.dataTransfer) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
      };
      const onDrop = (e: DragEvent) => {
        if (dragSrcPos === null || !e.dataTransfer) return;
        e.preventDefault();
        e.stopPropagation();
        const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
        if (at) {
          const tr = editor.state.tr;
          const $d = tr.doc.resolve(at.pos);
          let dd = $d.depth;
          while (dd > 0 && $d.node(dd).type.name !== 'taskItem') dd--;
          // 仅允许同层 (同一 taskList 内) 重排, 避免破坏嵌套层级。
          if (dd > 0 && dd === dragSrcDepth) {
            const targetPos = $d.before(dd);
            const srcNode = tr.doc.nodeAt(dragSrcPos);
            if (srcNode && targetPos !== dragSrcPos) {
              const size = srcNode.nodeSize;
              tr.insert(targetPos, srcNode);
              // 先插后删: 若目标在源之前, 删除起点需后移一个节点尺寸。
              let newSrc = dragSrcPos;
              if (targetPos < dragSrcPos) newSrc = dragSrcPos + size;
              tr.delete(newSrc, newSrc + size);
              editor.view.dispatch(tr);
            }
          }
        }
        dragSrcPos = null;
      };
      grip.addEventListener('dragstart', onDragStart);
      grip.addEventListener('dragend', () => {
        dragSrcPos = null;
      });
      listItem.addEventListener('dragover', onDragOver);
      listItem.addEventListener('drop', onDrop);
      const renderBadgesNow = () => {
        const fields = parseTaskFields(currentNode.textContent || '');
        badgesEl.replaceChildren(renderBadges(fields));
      };
      renderBadgesNow();
      listItem.append(badgesEl, editWrap);

      let prevRenderedAttributeKeys = new Set(Object.keys(HTMLAttributes));
      return {
        dom: listItem,
        contentDOM: content,
        stopEvent(event: Event) {
          const t = event.target as Node;
          // 拖拽相关事件交给我们自己的原生监听处理, 不让 PM 介入。
          if (event.type.startsWith('drag') && listItem.contains(t)) return true;
          if (grip.contains(t)) return true;
          if (badgesEl.contains(t)) return true;
          if (popoverEl && popoverEl.contains(t)) return true;
          if (editBtn.contains(t)) return true;
          if (content.contains(t)) return false;
          return true;
        },
        ignoreMutation(mutation: ViewMutationRecord) {
          return (
            badgesEl.contains(mutation.target) ||
            (!!popoverEl && popoverEl.contains(mutation.target)) ||
            editBtn.contains(mutation.target)
          );
        },
        update: (updatedNode: NodeViewRendererProps['node']) => {
          if (updatedNode.type !== this.type) return false;
          currentNode = updatedNode;
          listItem.dataset.checked = String(updatedNode.attrs.checked);
          checkbox.checked = updatedNode.attrs.checked;
          updateA11Y(updatedNode);
          const extensionAttributes = editor.extensionManager.attributes;
          const newHTMLAttributes = getRenderedAttributes(updatedNode, extensionAttributes);
          const newKeys = new Set(Object.keys(newHTMLAttributes));
          prevRenderedAttributeKeys.forEach((key) => {
            if (!newKeys.has(key)) {
              if (key in staticAttrs) listItem.setAttribute(key, staticAttrs[key] as string);
              else listItem.removeAttribute(key);
            }
          });
          Object.entries(newHTMLAttributes).forEach(([key, value]) => {
            if (value === null || value === undefined) {
              if (key in staticAttrs) listItem.setAttribute(key, staticAttrs[key] as string);
              else listItem.removeAttribute(key);
            } else {
              listItem.setAttribute(key, value as string);
            }
          });
          prevRenderedAttributeKeys = newKeys;
          renderBadgesNow();
          return true;
        },
        destroy() {
          closePopover();
        },
      };
    };
  },
});
