import { useCallback } from 'react';

import { displayTitleFromFilename } from '@/lib/utils';
import { sanitizeFileName, stripFrontmatter } from '@/lib/export-utils';
import { memos as memosClient, dialogs, type SaveFileFilter } from '@platform/tauri/client';
import { translate } from '@/lib/i18n';
import { useUserSettingsStore } from '@features/preferences/store/user-settings-store';
import { toast } from '@/lib/toast';
import type { MemoColor, MemoItem } from '@features/memo';

type ExportableDocument = { title: string; markdown: string };

type CommandKey =
  | 'document.command.readFailed'
  | 'document.command.noDocumentToExport'
  | 'document.command.copySuccess'
  | 'document.command.copyFailed'
  | 'document.command.copyPathSuccess'
  | 'document.command.unpinFailed'
  | 'document.command.pinFailed'
  | 'document.command.unpinSuccess'
  | 'document.command.pinSuccess'
  | 'document.command.exportMarkdown.success'
  | 'document.command.exportMarkdown.failed'
  | 'document.command.saveAsTemplate'
  | 'document.command.saveTemplateFailed'
  | 'document.command.pdfDocName'
  | 'document.command.exportFailed'
  | 'document.command.exportPdf.success';

function tCmd(key: CommandKey, params?: Record<string, string | number>): string {
  const language = useUserSettingsStore.getState().settings.language;
  return translate(language, key, params);
}

interface UseDocumentCommandsOptions {
  currentDocumentPath: string | null;
  getCurrentDocumentContent: () => string;
  currentMemo: MemoItem | null;
  updateMemoMeta: (id: string, meta: Partial<Pick<MemoItem, 'updatedAt' | 'preview' | 'thumbnail' | 'favorited' | 'filename'>>) => void;
  setMemoColors: (id: string, colors: MemoColor[]) => Promise<boolean>;
}

function extractTitleFromMarkdown(body: string): string {
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 与后端 `derivation::decode_html_entities` 对齐: 行首/行尾的空白类 HTML
    // 实体 (例如 `&nbsp;` / `&ensp;` / `&#160;`) 在标题里会被折叠为空, 不应作为内容
    // 泄漏到导出文件名 / 复制文本。
    const cleaned = trimmed
      .replace(/&nbsp;|&#160;|&#xa0;|&#xA0;| |&ensp;|&#8194;|&#x2002;|&emsp;|&#8195;|&#x2003;|&thinsp;|&#8201;|&#x2009;|&hairsp;|&#8202;|&#x200A;|&numsp;|&#8199;|&#x2007;|&puncsp;|&#8200;|&#x2008;|&mediumsp;|&#8287;|&#x205F;|&idsp;|&#12288;|&#x3000;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;|&#34;/g, '"')
      .trim();
    if (!cleaned) continue;
    return cleaned
      .replace(/^#+\s*/, '')
      .replace(/^[-*+]\s*\[[ xX]?\]\s*/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .slice(0, 120);
  }
  return '';
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export function useDocumentCommands({
  currentDocumentPath,
  getCurrentDocumentContent,
  currentMemo,
  updateMemoMeta,
  setMemoColors,
}: UseDocumentCommandsOptions) {
  const getExportableDocument = useCallback(async (): Promise<ExportableDocument | null> => {
    if (!currentDocumentPath) return null;

    let raw = getCurrentDocumentContent();
    if (!raw) {
      try {
        raw = (await memosClient.readDocument(currentDocumentPath)) ?? '';
      } catch (error) {
        console.warn('[useDocumentCommands] Failed to read document for export:', error);
        toast.error(tCmd('document.command.readFailed'));
        return null;
      }
    }

    const title = displayTitleFromFilename(currentMemo?.filename)
      || extractTitleFromMarkdown(stripFrontmatter(raw))
      || 'Untitled';
    return { title, markdown: raw };
  }, [currentDocumentPath, currentMemo?.filename, getCurrentDocumentContent]);

  const requireExportableDocument = useCallback(async () => {
    const doc = await getExportableDocument();
    if (!doc) {
      toast.error(tCmd('document.command.noDocumentToExport'));
      return null;
    }
    return doc;
  }, [getExportableDocument]);

  const promptExportTarget = useCallback(async (doc: ExportableDocument, extension: string, filter: SaveFileFilter) => {
    return dialogs.saveFile(`${sanitizeFileName(doc.title)}.${extension}`, [filter]);
  }, []);

  const handleCopyFullText = useCallback(async () => {
    if (!currentDocumentPath) return;

    try {
      const content = getCurrentDocumentContent() || await memosClient.readDocument(currentDocumentPath) || '';
      await writeClipboardText(content);
      toast.success(tCmd('document.command.copySuccess'));
    } catch (error) {
      console.warn('[useDocumentCommands] Failed to copy document content:', error);
      toast.error(tCmd('document.command.copyFailed'));
    }
  }, [currentDocumentPath, getCurrentDocumentContent]);

  const handleCopyLink = useCallback(async () => {
    if (!currentDocumentPath) return;

    try {
      await writeClipboardText(currentDocumentPath);
      toast.success(tCmd('document.command.copySuccess'));
    } catch (error) {
      console.warn('[useDocumentCommands] Failed to copy document link:', error);
      toast.error(tCmd('document.command.copyFailed'));
    }
  }, [currentDocumentPath]);

  const handleTogglePin = useCallback(async () => {
    if (!currentMemo) return;

    const wasFavorited = currentMemo.favorited;
    try {
      const ok = wasFavorited
        ? await memosClient.unfavoriteMemo(currentMemo.id)
        : await memosClient.favoriteMemo(currentMemo.id);

      if (!ok) {
        toast.error(tCmd(wasFavorited ? 'document.command.unpinFailed' : 'document.command.pinFailed'));
        return;
      }

      updateMemoMeta(currentMemo.id, { favorited: !wasFavorited });
      toast.success(tCmd(wasFavorited ? 'document.command.unpinSuccess' : 'document.command.pinSuccess'));
    } catch (error) {
      console.warn('[useDocumentCommands] Failed to toggle pin:', error);
      toast.error(tCmd(wasFavorited ? 'document.command.unpinFailed' : 'document.command.pinFailed'));
    }
  }, [currentMemo, updateMemoMeta]);

  const handleColorsChange = useCallback((next: MemoColor[]) => {
    if (!currentMemo) return;
    void setMemoColors(currentMemo.id, next);
  }, [currentMemo, setMemoColors]);

  const handleExportMarkdown = useCallback(async () => {
    const doc = await requireExportableDocument();
    if (!doc) return;

    const target = await promptExportTarget(doc, 'md', { name: 'Markdown', extensions: ['md', 'markdown'] });
    if (!target) return;

    let content = doc.markdown;
    try {
      const exportModule = await import('@/lib/export');
      const readImage = async (absPath: string): Promise<string | null> => {
        try {
          return await memosClient.readFileBase64(absPath);
        } catch {
          return null;
        }
      };
      content = await exportModule.embedImagesInMarkdown(doc.markdown, readImage);
    } catch {
      // 内联图片失败时回退到原始 markdown，已由最终 toast 提示结果
    }
    const ok = await dialogs.writeExportFile(target, content);
    toast[ok ? 'success' : 'error'](tCmd(ok ? 'document.command.exportMarkdown.success' : 'document.command.exportMarkdown.failed'));
  }, [promptExportTarget, requireExportableDocument]);

  const handleSaveAsTemplate = useCallback(async () => {
    const doc = await requireExportableDocument();
    if (!doc) return;

    try {
      const template = await memosClient.saveTemplate(doc.title, doc.markdown);
      toast.success(tCmd('document.command.saveAsTemplate', { name: template.name }));
    } catch (error) {
      console.warn('[useDocumentCommands] Failed to save template:', error);
      toast.error(tCmd('document.command.saveTemplateFailed'));
    }
  }, [requireExportableDocument]);

  const handleExportPdf = useCallback(async () => {
    const doc = await requireExportableDocument();
    if (!doc) return;

    const pdfDocName = tCmd('document.command.pdfDocName');
    const target = await promptExportTarget(doc, 'pdf', { name: pdfDocName, extensions: ['pdf'] });
    if (!target) return;

    let pdfBase64 = '';
    try {
      const exportModule = await import('@/lib/export');
      const readImage = async (absPath: string): Promise<string | null> => {
        try {
          return await memosClient.readFileBase64(absPath);
        } catch {
          return null;
        }
      };
      const inlinedMd = await exportModule.embedImagesInMarkdown(doc.markdown, readImage);
      let bodyHtml = exportModule.markdownToHtml(inlinedMd);
      bodyHtml = await exportModule.embedImagesInHtml(bodyHtml, readImage);
      const pdfExport = await import('@/lib/pdf-export');
      pdfBase64 = await pdfExport.htmlToPdfBase64(bodyHtml, doc.title);
    } catch {
      toast.error(tCmd('document.command.exportFailed'));
      return;
    }

    const ok = await dialogs.writeExportFileBytes(target, pdfBase64);
    toast[ok ? 'success' : 'error'](tCmd(ok ? 'document.command.exportPdf.success' : 'document.command.exportFailed'));
  }, [promptExportTarget, requireExportableDocument]);

  return {
    handleCopyFullText,
    handleCopyLink,
    handleTogglePin,
    handleColorsChange,
    handleExportMarkdown,
    handleSaveAsTemplate,
    handleExportPdf,
  };
}
