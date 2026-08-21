// 把已渲染的 HTML 转成真正的 .docx（OOXML）base64 字符串, 供导出功能写入磁盘。
// 底层用 vendored 的 html-docx-js（同目录 vendor/html-docx.js）。
import htmlDocx from '@/lib/vendor/html-docx';

/**
 * 将一段 HTML（body 片段即可）转换为 .docx 的 base64 字符串。
 *
 * html-docx-js 会把 <img src="data:..."> 作为媒体嵌入 docx, 因此调用前应先用
 * export.ts 的 embedImagesInHtml 把 asset:// 链接替换为 base64 data URI。
 */
export async function htmlToDocxBase64(bodyHtml: string): Promise<string> {
  const fullHtml =
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
    bodyHtml +
    '</body></html>';

  const blob = htmlDocx.asBlob(fullHtml, {
    orientation: 'portrait',
    margins: { top: 720, right: 720, bottom: 720, left: 720 },
  });

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}
