<p align="right">
  <a href="./README.md"><b>English</b></a> | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="./docs/images/app-icon.png" width="120" alt="TANK" />
</p>

<h1 align="center">TANK 英雄笔记<br />Local Markdown notes that link themselves</h1>

<p align="center"><strong>A local-first Markdown notebook with @-mention bidirectional links and clean PDF export.</strong></p>

<p align="center">
  Markdown · Local-first · Bidirectional Links · PDF Export
</p>

<p align="center">
  <a href="https://github.com/guail/tank/releases"><b>Download</b></a> ·
  <a href="https://github.com/guail/tank/releases"><b>Releases</b></a>
</p>

---

<img src="./docs/images/readme-introduce.gif" width="100%" alt="TANK" />

## Notes that connect themselves

Write in Markdown. Use `@` to mention another note and TANK builds the
backlinks automatically — open any note and see everything that points to it.
Your writing stays plain `.md` files on your own disk.

<img src="./docs/images/home-write.png" width="100%" alt="TANK notes shown across light and dark themes" />

---

## What it is good for

Keep product notes, development logs, research, and personal knowledge in one
place, all as local Markdown you can open with any editor.

| Use case | What it does |
| --- | --- |
| **Personal knowledge** | A calm local notebook that never locks you in. |
| **Bidirectional links** | `@`-mention a note to link it; backlinks appear automatically. |
| **Development logs** | Keep background, constraints, and decisions next to the code. |
| **Sharing to WeChat** | Export any note as a PDF that opens reliably in WeChat preview. |

<p align="center"><img src="./docs/images/home-nav.png" width="60%" alt="TANK navigation for notes, links, and tags" /></p>

---

## Your notes stay local and under your control

TANK saves your work as plain Markdown files on your device.

- **Files you can open anywhere** — Notes are standard Markdown, readable and
  editable with any other app.
- **No account required** — Everything lives on your disk. Sync and back up
  with whatever tools you already trust (cloud drive, git, USB).
- **Links that survive export** — `@`-mentions become real backlinks inside
  the notebook, not magic tied to a server.

---

## Quick start

1. Download the latest installer from [GitHub Releases](https://github.com/guail/tank/releases).
2. Create a new local folder, or register an existing folder as a notebook.
3. Create a document and start writing in Markdown.
4. Type `@` to link another note; the backlink shows up on the target note.
5. Export to PDF from the document menu when you need to share it.

## Local development

```bash
git clone https://github.com/guail/tank.git
cd tank
npm install

npm run dev
npm run tauri dev
npm run tauri build
```

The development environment requires Node.js 20+, Rust 1.75+ and Tauri v2;
the desktop app supports macOS 14+ and Windows 10+.

## License

TANK is distributed under the MIT License.

This project is a fork of [Flowix](https://github.com/text2future/flowix)
(original work Copyright the Flowix authors), adapted into a local-first
Markdown notebook. The original MIT License and copyright notices are
preserved in the source where applicable.
