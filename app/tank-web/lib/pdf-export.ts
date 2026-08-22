// 把已渲染的 HTML 转成真正的 .pdf（多页）base64 字符串, 供导出功能写入磁盘。
//
// 底层用 html2canvas（把 DOM 栅格化成 canvas, 中文因此自动以图像形式保留, 无需嵌入
// CJK 字体）+ jspdf（把 canvas 切片拼成多页 A4 PDF）。两个库都是现代 UMD, 通过 Vite
// 的 `?url` 导入当静态资源原样拷贝, 运行时再以经典 <script> 动态加载, 消费全局
// `window[html2canvas]` / `window.jspdf`。这样既能绕过 Rollup 对第三方 UMD 的解析,
// 又避免改动根 package.json（本仓库沙箱中 npm install 写不进 package.json）。
//
// 选 PDF 而非 Word/docx, 是因为微信内置文档预览对非微软生成的 docx 经常渲染失败（白屏）,
// 而微信对 PDF 预览稳定, 文字+图片都能正常显示。
import jspdfUrl from '@/lib/vendor/jspdf.umd.min.js?url';
import html2canvasUrl from '@/lib/vendor/html2canvas.min.js?url';

interface JsPDFPageSize {
  getWidth(): number;
  getHeight(): number;
}
interface JsPDFDoc {
  internal: { pageSize: JsPDFPageSize };
  setProperties(props: { title?: string; creator?: string }): void;
  addImage(imageData: string, format: string, x: number, y: number, width: number, height: number): void;
  addPage(): void;
  output(type: 'blob'): Blob;
}
interface JsPDFConstructor {
  new (options: { unit: string; format: string; orientation: string }): JsPDFDoc;
}
interface JsPdfGlobal {
  jsPDF: JsPDFConstructor;
}
type Html2CanvasFn = (element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>;

declare global {
  interface Window {
    jspdf?: JsPdfGlobal;
    html2canvas?: Html2CanvasFn;
  }
}

const OFFSCREEN_WIDTH = 794; // A4 宽度 @96dpi

const PRINT_CSS = `
.tank-pdf-root {
  box-sizing: border-box;
  width: ${OFFSCREEN_WIDTH}px;
  padding: 36px 40px;
  background: #ffffff;
  color: #1f2329;
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Hiragino Sans GB", sans-serif;
  font-size: 14px;
  line-height: 1.7;
}
.tank-pdf-root * { box-sizing: border-box; }
.tank-pdf-root h1 { font-size: 24px; margin: 0 0 16px; line-height: 1.3; }
.tank-pdf-root h2 { font-size: 20px; margin: 20px 0 12px; }
.tank-pdf-root h3 { font-size: 17px; margin: 16px 0 10px; }
.tank-pdf-root h4, .tank-pdf-root h5, .tank-pdf-root h6 { font-size: 15px; margin: 14px 0 8px; }
.tank-pdf-root p { margin: 0 0 12px; }
.tank-pdf-root ul, .tank-pdf-root ol { margin: 0 0 12px; padding-left: 24px; }
.tank-pdf-root li { margin: 4px 0; }
.tank-pdf-root blockquote { margin: 0 0 12px; padding: 8px 14px; border-left: 4px solid #d0d7de; background: #f6f8fa; color: #57606a; }
.tank-pdf-root code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 13px; background: #f0f2f5; padding: 2px 5px; border-radius: 4px; }
.tank-pdf-root pre { background: #f6f8fa; border: 1px solid #eaecef; border-radius: 6px; padding: 12px 14px; overflow: auto; margin: 0 0 12px; }
.tank-pdf-root pre code { background: transparent; padding: 0; }
.tank-pdf-root img { max-width: 100%; height: auto; border-radius: 4px; }
.tank-pdf-root table { border-collapse: collapse; width: 100%; margin: 0 0 12px; }
.tank-pdf-root th, .tank-pdf-root td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; }
.tank-pdf-root a { color: #2f6fed; text-decoration: underline; }
.tank-pdf-root hr { border: none; border-top: 1px solid #eaecef; margin: 16px 0; }
.tank-pdf-root strong { font-weight: 600; }
`;

let libsPromise: Promise<{ jspdf: JsPdfGlobal; html2canvas: Html2CanvasFn }> | null = null;

function loadLibs(): Promise<{ jspdf: JsPdfGlobal; html2canvas: Html2CanvasFn }> {
  if (libsPromise) return libsPromise;
  libsPromise = new Promise((resolve, reject) => {
    type Pending = { url: string; ready: () => boolean };
    const pending: Pending[] = [];
    if (!window.jspdf) pending.push({ url: jspdfUrl, ready: () => !!window.jspdf });
    if (!window.html2canvas) pending.push({ url: html2canvasUrl, ready: () => !!window.html2canvas });
    if (pending.length === 0) {
      resolve({ jspdf: window.jspdf as JsPdfGlobal, html2canvas: window.html2canvas as Html2CanvasFn });
      return;
    }
    let remaining = pending.length;
    let settled = false;
    const fail = (msg: string) => {
      if (!settled) {
        settled = true;
        reject(new Error(msg));
      }
    };
    const check = () => {
      if (settled) return;
      remaining -= 1;
      if (remaining === 0) {
        if (window.jspdf && window.html2canvas) {
          settled = true;
          resolve({ jspdf: window.jspdf, html2canvas: window.html2canvas });
        } else {
          fail('PDF libraries failed to initialize');
        }
      }
    };
    for (const p of pending) {
      const script = document.createElement('script');
      script.src = p.url;
      script.async = true;
      script.onload = () => (p.ready() ? check() : fail('PDF library global missing after load: ' + p.url));
      script.onerror = () => fail('Failed to load PDF library: ' + p.url);
      document.head.appendChild(script);
    }
  });
  return libsPromise;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          setTimeout(done, 4000);
        }),
    ),
  ).then(() => undefined);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 将一段 HTML（body 片段即可）转换为 .pdf 的 base64 字符串。
 *
 * 调用前应先用 export.ts 的 embedImagesInMarkdown / embedImagesInHtml 把 asset://
 * 图片链接替换为 base64 data URI, 这样 html2canvas 才能把图片栅格化进 PDF。
 */
export async function htmlToPdfBase64(bodyHtml: string, title: string): Promise<string> {
  const { jspdf, html2canvas } = await loadLibs();

  const container = document.createElement('div');
  container.className = 'tank-pdf-host';
  container.innerHTML = `<style>${PRINT_CSS}</style><div class="tank-pdf-root">${bodyHtml}</div>`;
  Object.assign(container.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: OFFSCREEN_WIDTH + 'px',
    background: '#ffffff',
    zIndex: '-1',
    pointerEvents: 'none',
  });
  document.body.appendChild(container);

  try {
    const root = container.querySelector('.tank-pdf-root') as HTMLElement;
    await waitForImages(root);
    await nextFrame();

    const canvas = await html2canvas(root, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: OFFSCREEN_WIDTH,
    });

    const doc = new jspdf.jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    doc.setProperties({ title, creator: 'TANK 英雄笔记' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    // 长图高度: 真实高度 = canvas 的物理像素 / scale, 否则图层被放大一倍导致切片错位。
    const pxPerPt = canvas.width / OFFSCREEN_WIDTH;
    const imgHeight = canvas.height / pxPerPt;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

    let heightLeft = imgHeight;
    let position = 0;
    doc.addImage(dataUrl, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position -= pageHeight;
      doc.addPage();
      doc.addImage(dataUrl, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const blob = doc.output('blob');
    return await blobToBase64(blob);
  } finally {
    if (container.parentNode) container.parentNode.removeChild(container);
  }
}
