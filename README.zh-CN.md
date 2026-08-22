<p align="right">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md"><b>简体中文</b></a>
</p>

<p align="center">
  <img src="./docs/images/app-icon.png" width="120" alt="TANK" />
</p>

<h1 align="center">TANK 英雄笔记<br />本地 Markdown 笔记，自动互链</h1>

<p align="center"><strong>本地优先的 Markdown 笔记本，支持 @ 提及双向链接与干净的 PDF 导出。</strong></p>

<p align="center">
  Markdown · 本地优先 · 双向链接 · PDF 导出
</p>

<p align="center">
  <a href="https://github.com/guail/tank/releases"><b>下载</b></a> ·
  <a href="https://github.com/guail/tank/releases"><b>发布页</b></a>
</p>

---

<img src="./docs/images/readme-introduce.gif" width="100%" alt="TANK" />

## 笔记自己连起自己

用 Markdown 记录，输入 `@` 提及另一篇笔记，TANK 会自动建立反向链接——打开任意一篇，就能看到所有指向它的笔记。你的内容始终是磁盘上普通的 `.md` 文件。

<img src="./docs/images/home-write.png" width="100%" alt="TANK 笔记在浅色与深色主题中的界面" />

---

## 适合用来做什么

把产品笔记、开发记录、研究资料和个人知识放在一处，全部是本地 Markdown，可用任意编辑器打开。

| 场景 | 说明 |
| --- | --- |
| **个人知识** | 一个安静、不锁死你的本地笔记本。 |
| **双向链接** | 用 `@` 提及一篇笔记即可建立链接，反向链接自动出现。 |
| **开发记录** | 把背景、约束和决策放在代码旁边。 |
| **发到微信** | 任意笔记导出为 PDF，在微信预览里稳定打开。 |

<p align="center"><img src="./docs/images/home-nav.png" width="60%" alt="TANK 中的笔记、链接与标签导航" /></p>

---

## 笔记留在本地，由你掌控

TANK 把你的内容保存为本地 Markdown 文件。

- **保存在本地** — 笔记是标准 Markdown，能用其他应用打开和编辑。
- **无需账号** — 一切都在你的磁盘上。同步和备份用你信任的工具（网盘、git、U 盘）即可。
- **链接在导出后依然有效** — `@` 提及在笔记本内成为真实的反向链接，不依赖任何服务器。

---

## 快速开始

1. 从 [GitHub Releases](https://github.com/guail/tank/releases) 下载最新安装包。
2. 新建一个本地文件夹，或将已有文件夹注册为笔记本。
3. 创建一篇文档，开始用 Markdown 写作。
4. 输入 `@` 链接另一篇笔记，目标笔记上会自动显示反向链接。
5. 需要分享时，从文档菜单导出为 PDF。

## 本地开发

```bash
git clone https://github.com/guail/tank.git
cd tank
npm install

npm run dev
npm run tauri dev
npm run tauri build
```

开发环境要求 Node.js 20+、Rust 1.75+ 与 Tauri v2；桌面应用支持 macOS 14+ 与 Windows 10+。

## 许可协议

TANK 基于 MIT 协议分发。

本项目是 [Flowix](https://github.com/text2future/flowix)（原作者 Copyright the Flowix authors）的 fork，改造为本地优先的 Markdown 笔记本。原项目的 MIT 许可与版权声明在源代码中按适用位置保留。
