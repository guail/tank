// Markdown export utilities for Markdown / Word (DOC) outputs.

import { Marked } from 'marked';
import { translate, type AppLanguage } from '@/lib/i18n';

const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const MAX_FILE_NAME_LENGTH = 120;

// Use a dedicated `Marked` instance so `@tiptap/markdown`'s global extensions
// (which register a `taskList` tokenizer without a renderer) don't leak in
// and crash `marked.parse()`. A fresh instance keeps the default GFM task
// list support and is untouched by anything `marked.use(...)` did to the
// singleton.
const exportMarked = new Marked({
  gfm: true,
  breaks: false,
  async: false,
});

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const ILLEGAL_FILENAME_CHARS = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|']);
const ILLEGAL_FILENAME_CONTROLS = new Set(
  Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(i))
);

const PRINT_BASE_STYLES = `
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.7;
    color: #1f2328;
    background: #ffffff;
    padding: 32px 40px;
  }
  h1, h2, h3, h4, h5, h6 {
    margin: 1.4em 0 0.6em;
    line-height: 1.3;
    font-weight: 600;
  }
  h1 { font-size: 1.8em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
  h2 { font-size: 1.45em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.25em; }
  h3 { font-size: 1.2em; }
  h4 { font-size: 1.05em; }
  p { margin: 0.6em 0; }
  a { color: #2563eb; text-decoration: none; }
  ul, ol { padding-left: 1.6em; margin: 0.6em 0; }
  li + li { margin-top: 0.2em; }
  blockquote {
    margin: 0.8em 0;
    padding: 0.2em 1em;
    color: #57606a;
    border-left: 3px solid #d0d7de;
    background: #f6f8fa;
  }
  code {
    font-family: "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 0.9em;
    background: rgba(175, 184, 193, 0.2);
    padding: 0.15em 0.35em;
    border-radius: 4px;
  }
  pre {
    background: #f6f8fa;
    padding: 14px 16px;
    border-radius: 6px;
    overflow-x: auto;
    line-height: 1.5;
  }
  pre code { background: transparent; padding: 0; font-size: 0.875em; }
  table {
    border-collapse: collapse;
    margin: 0.8em 0;
    display: block;
    overflow-x: auto;
  }
  th, td {
    border: 1px solid #d0d7de;
    padding: 6px 12px;
    text-align: left;
  }
  th { background: #f6f8fa; font-weight: 600; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5em 0; }
  img { max-width: 100%; height: auto; }
  input[type="checkbox"] { margin-right: 6px; }
  @media print {
    body { padding: 0; }
    pre, blockquote { page-break-inside: avoid; }
    h1, h2, h3, h4 { page-break-after: avoid; }
  }
`;

/** Strip the YAML frontmatter block (between leading `---` markers) from markdown content. */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_PATTERN, '').replace(/^\s+/, '');
}

/** Convert markdown source to an HTML string. GFM is enabled to match the editor. */
export function markdownToHtml(markdown: string): string {
  return exportMarked.parse(stripFrontmatter(markdown)) as string;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}

/**
 * Wrap rendered HTML in a Word-compatible HTML document (saved with a `.doc` extension).
 * Word treats these files as native documents and renders them with the declared styles.
 *
 * `language` 由调用方传入 (lib/util 不引入 React hook / user-settings-store)。
 */
export function buildWordHtml(title: string, bodyHtml: string, language: AppLanguage): string {
  const lang = language;
  const fallback = translate(lang, 'common.untitled');
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title || fallback)}</title>
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<![endif]-->
<style>${PRINT_BASE_STYLES}</style>
</head>
<body>
<main>${bodyHtml}</main>
</body>
</html>`;
}

/** Strip characters that are illegal in file names on common desktop file systems.
 *
 * `language` 由调用方传入 (lib/util 不引入 React hook / user-settings-store)。空名回落当前语言下的 common.untitled。
 */
export function sanitizeFileName(name: string, language: AppLanguage): string {
  const cleaned = (name || '')
    .split('')
    .map((ch) => (ILLEGAL_FILENAME_CONTROLS.has(ch) || ILLEGAL_FILENAME_CHARS.has(ch) ? '_' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH);
  if (cleaned) return cleaned;
  const lang = language;
  return translate(lang, 'common.untitled');
}

/**
 * 把 Tauri 的 `asset://localhost/<encoded>` 或 `http(s)://asset.localhost/<encoded>`
 * 还原成真实本地绝对路径。与 `features/editor/extensions/attachment-link/utils` 的
 * `decodeStorageKey` 同源, 这里内联一份避免 lib -> features 循环依赖。
 */
export function decodeAssetUrl(src: string): string | null {
  if (
    !src.startsWith('asset://') &&
    !src.startsWith('http://asset.localhost/') &&
    !src.startsWith('https://asset.localhost/')
  ) {
    return null;
  }
  try {
    const encoded = src
      .replace('asset://localhost/', '')
      .replace('http://asset.localhost/', '')
      .replace('https://asset.localhost/', '');
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
};

function mimeForPath(absPath: string): string {
  const ext = absPath.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/**
 * 把 markdown 里的附件图片 (`![alt](asset://localhost/...)`) 内联为 base64 data URI,
 * 这样导出的 .md 自包含、图片随文件走。同时去掉 pandoc 风格的 `{width=...}` 残留
 * 属性 (marked 不识别, 会作为纯文本残留在导出结果里)。
 *
 * `readImage(absPath)` 由调用方注入 (经 IPC 读二进制), 返回 base64 或 null。
 * 读取失败则保留原 asset 链接, 不阻断导出。
 */
export async function embedImagesInMarkdown(
  markdown: string,
  readImage: (absPath: string) => Promise<string | null>,
): Promise<string> {
  const re =
    /!\[([^\]]*)\]\((asset:\/\/localhost\/[^)\s]+|https?:\/\/asset\.localhost\/[^)\s]+)\)(\{[^{}]*\})?/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const full = m[0];
    const alt = m[1];
    const assetUrl = m[2];
    const abs = decodeAssetUrl(assetUrl);
    out += markdown.slice(last, m.index);
    if (abs) {
      const b64 = await readImage(abs);
      if (b64) {
        out += `![${alt}](data:${mimeForPath(abs)};base64,${b64})`;
      } else {
        out += full;
      }
    } else {
      out += full;
    }
    last = m.index + full.length;
  }
  out += markdown.slice(last);
  return out;
}

/**
 * 兜底: 扫描已渲染 HTML 里的 `<img src="asset://...">` 并替换为 base64 data URI。
 * 用于 markdown 里直接用 HTML `<img>` 标签写图片的场景 (标准 `![...]()` 已在 markdown
 * 阶段内联, 这里通常不再命中, 仅作安全兜底)。
 */
export async function embedImagesInHtml(
  html: string,
  readImage: (absPath: string) => Promise<string | null>,
): Promise<string> {
  const re =
    /<img\b[^>]*\ssrc=["'](asset:\/\/localhost\/[^"']+|https?:\/\/asset\.localhost\/[^"']+)["'][^>]*>/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const full = m[0];
    const assetUrl = m[1];
    const abs = decodeAssetUrl(assetUrl);
    out += html.slice(last, m.index);
    if (abs) {
      const b64 = await readImage(abs);
      if (b64) {
        out += full.replace(assetUrl, `data:${mimeForPath(abs)};base64,${b64}`);
      } else {
        out += full;
      }
    } else {
      out += full;
    }
    last = m.index + full.length;
  }
  out += html.slice(last);
  return out;
}
