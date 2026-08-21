// 把已渲染的 HTML 转成真正的 .docx（OOXML）base64 字符串, 供导出功能写入磁盘。
//
// 底层用 html-docx-js（lib/vendor/html-docx.js）。该库是老式 UMD, 内含 `with` 语句,
// 现代 Rollup/Vite 打包时会直接 panic（"Cannot convert Stmt::With"）。因此这里用
// Vite 的 `?url` 导入把文件当作静态资源原样拷贝（不解析）, 运行时再以经典 <script>
// 标签动态加载, 消费其全局 `window.htmlDocx`。经典脚本允许 `with`, 故可正常运行。
import htmlDocxUrl from '@/lib/vendor/html-docx.js?url';

interface HtmlDocxMargins {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

interface HtmlDocxOptions {
  orientation?: 'portrait' | 'landscape';
  margins?: HtmlDocxMargins;
}

interface HtmlDocxApi {
  asBlob(html: string, options?: HtmlDocxOptions): Blob;
}

declare global {
  interface Window {
    htmlDocx?: HtmlDocxApi;
  }
}

let htmlDocxPromise: Promise<HtmlDocxApi> | null = null;

function loadHtmlDocx(): Promise<HtmlDocxApi> {
  if (htmlDocxPromise) return htmlDocxPromise;
  htmlDocxPromise = new Promise<HtmlDocxApi>((resolve, reject) => {
    if (window.htmlDocx) {
      resolve(window.htmlDocx);
      return;
    }
    const script = document.createElement('script');
    script.src = htmlDocxUrl;
    script.async = true;
    script.onload = () => {
      if (window.htmlDocx) {
        resolve(window.htmlDocx);
      } else {
        reject(new Error('html-docx script loaded but window.htmlDocx is missing'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load html-docx.js'));
    document.head.appendChild(script);
  });
  return htmlDocxPromise;
}

/**
 * 将一段 HTML（body 片段即可）转换为 .docx 的 base64 字符串。
 *
 * html-docx-js 会把 <img src="data:..."> 作为媒体嵌入 docx, 因此调用前应先用
 * export.ts 的 embedImagesInHtml 把 asset:// 链接替换为 base64 data URI。
 */
export async function htmlToDocxBase64(bodyHtml: string): Promise<string> {
  const api = await loadHtmlDocx();
  const fullHtml =
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
    bodyHtml +
    '</body></html>';

  const blob = api.asBlob(fullHtml, {
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
