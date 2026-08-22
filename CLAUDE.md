# CLAUDE.md

This file provides guidance to AI coding agents when working with code in this repository.

TANK 英雄笔记（fork 自 Flowix）是一款本地优先的桌面笔记应用（**Tauri 2 + Rust 后端，React 19 + TS + Tiptap 前端**）。核心能力：本地 Markdown 笔记、`@` 提及双向链接、PDF 导出。内置可选 AI 代理（配置 API key 后可用，走 `openai_compatible` provider）。

## 命令

```bash
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
npm run tauri:dev        # 推荐：独立 dev bundle ID，可与生产 app 并存
npm run tauri:dev:win    # Windows 开发启动：使用 app/tank-desktop/tauri.windows.dev.conf.json
npm run tauri dev        # ⚠️ 走默认 tauri.conf.json，与生产同 bundle ID，已被生产占住时会立刻 exit 0
npm run dev              # 仅前端 (localhost:1420)
npm run tauri build      # 生产构建
npm run cli:build        # 编 CLI sidecar 到 app/tank-desktop/binaries/（当前 host）
npm run cli:build:all    # CI 用：三平台（linux / macOS ×2 / windows）全编
pkill -f "node.*vite" 2>/dev/null   # 端口冲突时
```

移动原生工程由 Tauri CLI 生成，不手工维护 `app/tank-mobile/gen/android` 或
`app/tank-mobile/gen/apple`。Android 需要先安装 JDK、Android SDK/NDK 并设置
`ANDROID_HOME`、`NDK_HOME`；iOS 需要完整 Xcode（只有 Command Line Tools 不够）。

Rust 测试（在 `app/` 目录跑）：

```bash
cd app
cargo test -p tank-core <module>::tests           # 跑某 crate 某模块
cargo test -p tank-core <module>::tests::test_xxx # 跑单个
cargo test --workspace --lib                         # 跑全部
```

## Dev / Prod 并存打包

通过差异化 Tauri 配置，让 dev 版与已安装的生产版同时运行：

- **dev**：`npm run tauri:dev` → `app/tank-desktop/tauri.conf.dev.json` → 独立 dev bundle ID
- **生产**：`npm run tauri:build:production` → `tauri.conf.json` + 平台覆盖层 + 签名覆盖层
- **默认 build**：`npm run tauri:build` → 默认 `tauri.conf.json` → 生产身份（无签名，便于本地试装）

`tauri:dev` 通过 `--config` 指向独立配置，**不要**改 `tauri.conf.json` 的 `identifier` / `productName` / `mainBinaryName` / `bundle.macOS.bundleName` —— 这四个字段是生产身份的锚点。

## macOS 发布流水线（Developer ID 直分发 + Notarization）

production 发版走 Apple Developer ID 直分发（不走 Mac App Store），完整脚本在 `scripts/apple-signing/`。注意 CLI sidecar 与 `.app` 的 ad-hoc / Developer ID 签名细节见该目录 README。

## Rules

- 在非常确信情况下再进行代码修改
- 保持专业架构设计，不写垃圾代码
- 不随意改动运行时数据目录路径（如 `~/.flowix`）与 bundle identifier，否则会破坏已装用户的数据与升级链路

## 架构图

```
tank-main/
├── app/                                  # Rust workspace
│   ├── Cargo.toml                        # workspace 清单
│   │
│   ├── tank-core/                        # 业务核心（零 Tauri 依赖，CLI + Desktop 共享）
│   │   └── src/
│   │       ├── lib.rs                    # crate 入口
│   │       ├── search.rs                 # 全文搜索
│   │       └── memo_file/                # 笔记存储层
│   │           ├── mod.rs                # 模块入口
│   │           ├── content.rs            # 内容读写
│   │           ├── frontmatter.rs        # 元数据头
│   │           ├── index_store.rs        # 索引存储
│   │           ├── notebook.rs           # 笔记本
│   │           ├── ops.rs                # CRUD
│   │           ├── derivation.rs         # 派生计算
│   │           ├── registration.rs       # 注册管理
│   │           ├── types.rs              # 类型定义
│   │           ├── time.rs               # 时间工具
│   │           └── tests.rs              # 单元测试
│   │
│   ├── tank-desktop/                     # Tauri 2 桌面壳
│   │   ├── tauri.conf.json               # Tauri 配置
│   │   ├── build.rs                      # 构建脚本
│   │   ├── binaries/                     # CLI sidecar 产物
│   │   └── src/
│   │       ├── main.rs                   # 应用入口
│   │       ├── lib.rs                    # 装配 run()
│   │       ├── agent.rs                  # AI 代理
│   │       ├── agent_access.rs           # 代理鉴权
│   │       ├── threads.rs                # 会话线程
│   │       ├── fs_watcher.rs             # 文件监听
│   │       ├── memo_events.rs            # 笔记事件
│   │       ├── global_meta_data.rs       # 全局元数据
│   │       ├── user_config.rs            # 用户配置
│   │       ├── path_scope.rs             # 路径白名单
│   │       ├── commands/                 # Tauri IPC 命令
│   │       ├── providers/                # LLM provider
│   │       ├── watcher/                  # 监听器流水线
│   │       ├── prompt/                   # 系统提示词
│   │       └── open_target/              # 跨端链接打开
│   │
│   ├── tank-cli/                         # CLI sidecar（Tauri shell 调用）
│   │   └── src/
│   │       ├── main.rs                   # CLI 入口
│   │       ├── lib.rs                    # 子命令派发
│   │       ├── editor.rs                 # 外部编辑器
│   │       ├── store.rs                  # 复用 core
│   │       ├── paths.rs                  # 路径解析
│   │       ├── fmt.rs                    # 输出格式
│   │       └── errors.rs                 # 错误定义
│   │
│   └── tank-web/                         # React 19 + Vite 前端
│       ├── index.html                    # HTML 入口
│       ├── main.tsx                      # Vite 入口
│       ├── app.tsx                       # 根组件
│       ├── lib/                          # 状态层 / IPC / 工具
│       │   ├── store/                    # Zustand 状态层
│       │   ├── tauri/                    # IPC 封装
│       │   ├── export.ts                 # 导出工具（docx→PDF）
│       │   └── toast.tsx                 # Toast 通知
│       └── windows/                      # 主窗口 / 偏好窗口
│
├── scripts/                              # 构建 / 签名 / 发版辅助
│   ├── build-cli.sh
│   ├── prepare-tauri-production-config.mjs
│   ├── sign-cli.sh
│   ├── verify-macos-release.sh
│   ├── release.sh / upload-release.sh / rename-dmg.sh
│   └── apple-signing/                    # Developer ID + notarization 流水线
│
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

**说明：**
- **`tank-core`** 是纯 Rust 库，无 Tauri 依赖，被 `tank-desktop` 与 `tank-cli` 共享。
- **`tank-desktop`** 负责 Tauri 装配：commands（IPC）、watcher（文件监听管线）、providers（LLM 调用）、open_target（深链）。
- **`tank-web`** 单仓双窗口（main + preferences）：state 用 Zustand，编辑器用 Tiptap + Shiki，IPC 走 `lib/tauri/client.ts`。
- 顶层 `skills/`、`dist/`、`node_modules/`、`app/target/` 为产物 / 资源 / 衍生目录，已省略。
