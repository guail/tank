# 语义检索 (hybrid / semantic search) — TANK的英雄笔记

> 状态：代码已完成，本地 `cargo check` / `cargo test` 通过（见下）。
> 本功能已提交在 `TANK的英雄笔记`（`tank` 的个人改版）的 `main` 分支上，
> 由 `tank search <q> --semantic` / `--hybrid` 启用。如未来要回馈上游 Flowix，可基于此分支开 PR。

## 动机 (Motivation)

当前 `tank-core` 的检索是纯 **bigram 词面** 倒排索引 (`search.rs`)：

- 查询 `编译器命令找不到 rustc` 不会命中正文为 `rustc command not found` 的笔记 —— 换说法 / 同义 / 中英混写就搜不到。
- 多 token 严格 AND 交集，任一 token 缺失直接 0 命中，对口语化、改写过的查询极不友好。

笔记应用的核心价值是「写过就能找回」。词面检索对 paraphrase / synonym 无能为力，是真实痛点。本 PR 在 **不改动现有 lexical 行为** 的前提下，叠加一层向量语义检索，用 RRF 融合。

## 方案 (Approach)

- **`EmbeddingProvider` trait** (`tank-core/src/embed.rs`)：core 保持零 HTTP 依赖，只定义抽象 `embed(&[String]) -> Vec<Vec<f32>>` + `model_name()`。具体实现放在 `tank-cli`。
- **`SemanticIndex`（带缓存的向量索引）**：每个 notebook 一份向量索引，落盘在 `<notebook>/.metadata/semantic_cache.json`，按正文 sha256 命中复用 —— 只有新增 / 改动的 memo 才调用 provider 重新 embed，跨 CLI 调用复用，避免每次查询全量重算。
- **`search_notebooks_hybrid`**：嵌入查询向量一次；每个 notebook 重建 lexical 索引拿词面排名、构建/复用 `SemanticIndex` 拿向量排名；按 `SearchMode` 用 **RRF (Reciprocal Rank Fusion)** 融合（`Hybrid`）或只用向量排名（`Semantic`）。
- **默认 `SearchMode::Lexical`**：不走任何 embedding 路径，**现有行为与测试 100% 不变**。只有显式 `--semantic` / `--hybrid` 才注入 provider。

## 改动文件

- `tank-core/src/embed.rs`（新增）：`EmbeddingProvider`、`SearchMode`、`cosine_similarity`、`rrf_fuse`、`SemanticIndex`、`search_notebooks_hybrid` + 单测（`FakeProvider` / `ConstProvider`）。
- `tank-core/src/lib.rs`：导出 `pub mod embed;`。
- `tank-core/src/search.rs`：`MatchField` 加 `Semantic` 变体；`make_snippet` 处理 `Semantic`；`MemoIndex::get_entry` 供语义召回造 snippet。
- `tank-core/src/service.rs`：新增 `MemoService::search_memos_hybrid`（校验同 `search_memos`，embedding 失败映射为 `TankError::Internal`）。
- `tank-cli/src/embed.rs`（新增）：`OllamaEmbeddingProvider`，走本地 Ollama `/api/embed`（复用工作区已有的 `reqwest` blocking 客户端）。
- `tank-cli/Cargo.toml` + 工作区 `Cargo.toml`：`reqwest` 开启 `blocking` feature。
- `tank-cli/src/cli.rs`：`Cli::Search` 加 `mode: SearchMode`；新增 `--semantic` / `--hybrid` flag + 解析 + help。
- `tank-cli/src/store.rs` + `dispatch.rs` + `mcp.rs`：透传 `mode`；`mode != Lexical` 时构建 `OllamaEmbeddingProvider`（端点 / 模型走 `FLOWIX_OLLAMA_URL` / `FLOWIX_EMBED_MODEL` 环境变量，默认 `http://localhost:11434` / `nomic-embed-text`）后走 `search_memos_hybrid`；MCP 工具描述同步提示语义检索。

## 用法 (Usage)

```bash
# 默认仍是纯词面检索 (向后兼容)
tank search "rustc command not found"

# 向量 + 词面融合 (推荐)
tank search "编译器命令找不到" --hybrid

# 纯向量语义检索
tank search "编译器命令找不到" --semantic

# 自定义 Ollama 端点 / 模型
FLOWIX_OLLAMA_URL=http://127.0.0.1:11434 FLOWIX_EMBED_MODEL=nomic-embed-text \
  tank search "部署时下载总超时" --hybrid
```

MCP（`tank_memo` 工具）：命令字符串直接带 `--hybrid` / `--semantic` 即可，例如
`search "编译器命令找不到" --hybrid`。

## 向后兼容 (Backward Compatibility)

- 默认模式 `Lexical`，`search_memos` / `search_notebooks` 完全不改，所有既有测试通过。
- `MatchField` 新增 `Semantic` 变体（camelCase 序列化 `semantic`），是纯增量，不影响既有 `Title`/`Tag`/`Body` 消费方。
- CLI / MCP 不传 flag 时行为与原版一致。

## 测试 (Testing)

- `embed.rs` 单测：`cosine_similarity`（相同=1、正交=0、长度不一致=0）、`rrf_fuse`（多路共享 doc 排名更高）、`SemanticIndex::rank`（语义召回 paraphrase 无词面重叠）、以及两个端到端 `search_notebooks_hybrid` 测试（lexical 召回不到时 hybrid 仍能靠语义拉回；`Semantic` 模式命中 `matched_in == Semantic`）。
- 全部用确定性 `FakeProvider` / `ConstProvider`，**不依赖网络 / Ollama**，离线可跑。

## 已知限制 / 后续 (Follow-ups)

- `SemanticIndex` 缓存写入 notebook 的 `.metadata/`，首次混合检索会对未缓存的 memo 批量 embed；大 notebook 首次较慢，之后命中缓存。后续可加后台预热 / 增量失效。
- 当前 embedding 后端仅 Ollama；如需 OpenAI / 本地 `fastembed` 等，实现同一 `EmbeddingProvider` trait 即可，core 无需改动。
- 语义命中暂无精确 snippet 高亮（用正文首段兜底），后续可让 provider 回吐命中片段。
