// 第三方库 html-docx-js（自包含 UMD, 已把 jszip 打进 dist）的本地类型声明。
// 实际实现见同目录 html-docx.js（vendored; 债务门禁只扫 .ts/.tsx, 故 .js 不计入）。
//
// 作用: 把 HTML 字符串转换为真正的 .docx（OOXML zip）。之前导出是"HTML 伪装成
// .doc", 只有桌面 Office/WPS 容错打开, 微信/移动端预览直接拒绝；换成真 .docx 后
// Word / WPS / 微信 / LibreOffice 全都能直接打开。
//
// 注意: 本声明只描述我们用到的 asBlob; 图片请传 <img src="data:..."> (base64),
// 库会把它们作为媒体嵌入 docx。

declare module '@/lib/vendor/html-docx' {
  export interface HtmlDocxMargins {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  }

  export interface HtmlDocxOptions {
    orientation?: 'portrait' | 'landscape';
    margins?: HtmlDocxMargins;
  }

  const htmlDocx: {
    asBlob(html: string, options?: HtmlDocxOptions): Blob;
  };

  export default htmlDocx;
}
