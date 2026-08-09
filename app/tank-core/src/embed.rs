//! 语义检索 (semantic / hybrid search).
//!
//! 纯 lexical 检索见 [`crate::search`]. 本模块在 lexical 之上叠加一层
//! 向量语义检索, 用 [`EmbeddingProvider`] 抽象屏蔽具体的 embedding 后端
//! (默认实现在 flowix-cli: Ollama `/api/embed`).
//!
//! # 设计
//! - **EmbeddingProvider**: core 不依赖任何 HTTP 库, 只定义 trait; 具体
//!   实现 (Ollama) 放在 flowix-cli, 经 `&dyn EmbeddingProvider` 注入.
//! - **SemanticIndex**: 每个 notebook 一份向量缓存, 落盘在
//!   `<notebook>/.metadata/semantic_cache.json`, 按正文内容 sha256 命中
//!   复用, 只有新增/改动的 memo 才调用 provider 重新 embed. 跨 CLI 调用复用.
//! - **融合**: hybrid 模式把 lexical 排名与 semantic 排名用 RRF
//!   (Reciprocal Rank Fusion) 融合; semantic 模式只用向量排名.
//! - **向后兼容**: [`SearchMode::Lexical`] 走原 `search_notebooks`, 行为不变
//!   (见 [`crate::service::MemoService::search_memos`]).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::memo_file::frontmatter::extract_body_content;
use crate::memo_file::{MemoFile, NotebookConfig};
use crate::search::{
    make_snippet, rebuild_index_from_store, BigramTokenizer, MatchField, MemoIndex,
    MemoSearchHit, NotebookSearchHit, NotebookSearchResults,
};

/// 检索模式. 默认 [`SearchMode::Lexical`] 保持原有行为.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SearchMode {
    /// 纯 bigram 词面检索 (原行为).
    #[default]
    Lexical,
    /// lexical + semantic 经 RRF 融合.
    Hybrid,
    /// 仅向量语义检索.
    Semantic,
}

/// 一个文本 embedding 后端.
///
/// core 不绑定任何具体实现 / HTTP 库; flowix-cli 提供基于 Ollama 的实现,
/// 经 `&dyn EmbeddingProvider` 注入到检索层.
pub trait EmbeddingProvider: Send + Sync {
    /// 后端使用的模型名 (用于缓存失效判定).
    fn model_name(&self) -> &str;
    /// 批量 embed. 返回的向量数量必须与输入文本数量一致.
    fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String>;
}

/// 余弦相似度. 两向量长度不一致或任一为零向量时返回 0.0 (避免 NaN 污染排序).
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0_f32;
    let mut na = 0.0_f32;
    let mut nb = 0.0_f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    let norm = na.sqrt() * nb.sqrt();
    if norm == 0.0 {
        0.0
    } else {
        dot / norm
    }
}

/// Reciprocal Rank Fusion. 多路有序排名按 `1/(k+rank)` 累加到同一 doc,
/// 不依赖各路原始分数量纲. `runs` 中每个元素是「有序 id 列表」(index 0 = 第 1 名).
pub fn rrf_fuse(runs: &[Vec<String>], k: usize) -> Vec<(String, f32)> {
    let mut scores: HashMap<String, f32> = HashMap::new();
    for run in runs {
        for (rank, id) in run.iter().enumerate() {
            let contribution = 1.0 / (k as f32 + (rank + 1) as f32);
            *scores.entry(id.clone()).or_insert(0.0) += contribution;
        }
    }
    let mut out: Vec<(String, f32)> = scores.into_iter().collect();
    out.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

// ---- SemanticIndex (cached vector store) ----

#[derive(Serialize, Deserialize, Default)]
struct CacheEntry {
    hash: String,
    vec: Vec<f32>,
}

#[derive(Serialize, Deserialize, Default)]
struct SemanticCacheFile {
    model: String,
    entries: HashMap<String, CacheEntry>,
}

/// 一个 notebook 的向量索引 (内存态), 背后有落盘缓存.
pub struct SemanticIndex {
    vecs: HashMap<String, Vec<f32>>,
}

fn hash_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let digest = hasher.finalize();
    format!("{digest:x}")
}

impl SemanticIndex {
    /// 构造 / 复用某 notebook 的向量索引.
    ///
    /// - 读 `<notebook_path>/.metadata/semantic_cache.json` (若存在).
    /// - `model` 变化 → 整个缓存失效重建.
    /// - 逐 memo 比对正文 sha256: 命中且 model 一致 → 复用缓存向量; 否则
    ///   调用 `provider.embed` 重新计算并写回缓存.
    pub fn build(
        memo_file: &MemoFile,
        notebook_id: &str,
        notebook_path: &str,
        model: &str,
        provider: &dyn EmbeddingProvider,
    ) -> Result<SemanticIndex, String> {
        let cache_path = PathBuf::from(notebook_path)
            .join(".metadata")
            .join("semantic_cache.json");

        let mut cache: SemanticCacheFile = if cache_path.exists() {
            std::fs::read_to_string(&cache_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            SemanticCacheFile::default()
        };
        if cache.model != model {
            cache.entries.clear();
            cache.model = model.to_string();
        }

        let items = memo_file.read_all_memos_with_body_for_notebook_id(Some(notebook_id));
        let mut vecs: HashMap<String, Vec<f32>> = HashMap::new();
        let mut pending: Vec<(String, String, String)> = Vec::new(); // (id, body, hash)

        for (entry, full_md) in items {
            let body = extract_body_content(&full_md);
            let hash = hash_text(&body);
            if let Some(c) = cache.entries.get(&entry.id) {
                if c.hash == hash {
                    vecs.insert(entry.id.clone(), c.vec.clone());
                    continue;
                }
            }
            pending.push((entry.id.clone(), body.to_string(), hash));
        }

        if !pending.is_empty() {
            let bodies: Vec<String> = pending.iter().map(|(_, b, _)| b.clone()).collect();
            let embedded = provider
                .embed(&bodies)
                .map_err(|e| format!("semantic search: embedding failed ({e})"))?;
            if embedded.len() != pending.len() {
                return Err(format!(
                    "semantic search: embedding provider returned {} vectors for {} inputs",
                    embedded.len(),
                    pending.len()
                ));
            }
            for ((id, _body, hash), vec) in pending.into_iter().zip(embedded) {
                cache
                    .entries
                    .insert(id.clone(), CacheEntry { hash, vec: vec.clone() });
                vecs.insert(id, vec);
            }
            if let Some(parent) = cache_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(json) = serde_json::to_string(&cache) {
                let _ = std::fs::write(&cache_path, json);
            }
        }

        Ok(SemanticIndex { vecs })
    }

    /// 用查询向量给本 notebook 所有 memo 打分, 返回有序 (id, score) 列表 (score = 余弦相似度).
    pub fn rank(&self, query_vec: &[f32], top_k: usize) -> Vec<(String, f32)> {
        let mut scored: Vec<(String, f32)> = self
            .vecs
            .iter()
            .map(|(id, v)| (id.clone(), cosine_similarity(query_vec, v)))
            .collect();
        scored.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        scored.truncate(top_k);
        scored
    }
}

/// 跨 notebook 的 hybrid / semantic 检索.
///
/// - 嵌入查询向量一次.
/// - 每个 notebook: 重建 lexical 索引拿 lexical 排名; 构建/复用 SemanticIndex
///   拿 semantic 排名; 按模式用 RRF 融合 (Hybrid) 或只用 semantic (Semantic).
/// - 融合后的 memo 经 [`MemoIndex::get_entry`] 取 filename / 正文造 snippet:
///   lexical 命中的复用其 snippet 与匹配字段; 仅 semantic 命中的用首段兜底.
pub fn search_notebooks_hybrid(
    memo_file: &MemoFile,
    configs: &[NotebookConfig],
    notebook_filter: Option<&str>,
    query: &str,
    limit: usize,
    mode: SearchMode,
    provider: &dyn EmbeddingProvider,
) -> Result<NotebookSearchResults, String> {
    let query = query.trim();
    if query.is_empty() || limit == 0 {
        return Ok(NotebookSearchResults {
            query: query.to_string(),
            hits: Vec::new(),
            total: 0,
        });
    }

    let query_vec = provider
        .embed(&[query.to_string()])
        .map_err(|e| format!("semantic search: embedding query failed ({e})"))?
        .into_iter()
        .next()
        .ok_or_else(|| {
            "semantic search: embedding provider returned no vector for query".to_string()
        })?;

    let model = provider.model_name();
    let tokenizer = Arc::new(BigramTokenizer);
    // RRF 内部排名取比 limit 宽一些, 避免截断丢相关项; 最终仍按 limit 截断.
    let inner_k = limit.max(50);
    let query_for_contains: String = query.to_lowercase().split_whitespace().collect();

    let mut all_hits: Vec<NotebookSearchHit> = Vec::new();

    for notebook in configs.iter().filter(|config| {
        notebook_filter
            .map(|filter| config.id == filter || config.name == filter)
            .unwrap_or(true)
    }) {
        let mut lex_index = MemoIndex::new(tokenizer.clone());
        rebuild_index_from_store(&mut lex_index, memo_file, notebook.id.clone());

        let lex_hits = lex_index.search(query, inner_k);
        let lex_run: Vec<String> = lex_hits.iter().map(|h| h.id.clone()).collect();
        let lex_map: HashMap<&str, &MemoSearchHit> =
            lex_hits.iter().map(|h| (h.id.as_str(), h)).collect();

        let sem_index = SemanticIndex::build(
            memo_file,
            &notebook.id,
            &notebook.path,
            model,
            provider,
        )?;
        let sem_run: Vec<String> = sem_index
            .rank(&query_vec, inner_k)
            .into_iter()
            .map(|(id, _)| id)
            .collect();

        let fused: Vec<(String, f32)> = match mode {
            SearchMode::Semantic => rrf_fuse(&[sem_run], 60),
            SearchMode::Hybrid | SearchMode::Lexical => rrf_fuse(&[lex_run, sem_run], 60),
        };

        for (id, score) in fused.into_iter().take(limit) {
            let Some(entry) = lex_index.get_entry(&id) else {
                continue;
            };
            let (matched_in, snippet) = if let Some(lh) = lex_map.get(id.as_str()) {
                (lh.matched_in.clone(), lh.snippet.clone())
            } else {
                let snip = make_snippet(entry, &query_for_contains, &MatchField::Semantic);
                (MatchField::Semantic, snip)
            };
            all_hits.push(NotebookSearchHit {
                notebook_id: notebook.id.clone(),
                notebook_name: notebook.name.clone(),
                notebook_path: notebook.path.clone(),
                id: id.clone(),
                filename: entry.filename.clone(),
                snippet,
                matched_in,
                score,
                updated_at: entry.updated_at,
            });
        }
    }

    all_hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
    let total = all_hits.len();
    all_hits.truncate(limit);

    Ok(NotebookSearchResults {
        query: query.to_string(),
        hits: all_hits,
        total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memo_file::{MemoFile, MemoIndexEntry, NotebookConfig};
    use crate::search::search_notebooks;
    use crate::MemoService;
    use std::sync::Arc;

    /// 确定性假 provider: 把文本 embed 成「词袋」向量 (词按字符哈希分桶),
    /// 不依赖网络 / 模型. 用于单测融合与语义召回逻辑.
    struct FakeProvider {
        dim: usize,
    }

    impl FakeProvider {
        fn embed_one(&self, text: &str) -> Vec<f32> {
            let mut v = vec![0.0_f32; self.dim];
            for ch in text.chars() {
                let idx = (ch as usize) % self.dim;
                v[idx] += 1.0;
            }
            v
        }
    }

    impl EmbeddingProvider for FakeProvider {
        fn model_name(&self) -> &str {
            "fake"
        }
        fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
            Ok(texts.iter().map(|t| self.embed_one(t)).collect())
        }
    }

    /// 退化 provider: 任何文本都返回同一个单位向量. 用于验证「lexical 召回不到时,
    /// hybrid 仍能靠 semantic 把相关 memo 拉回来」这条链路 (而非 provider 质量).
    struct ConstProvider;

    impl EmbeddingProvider for ConstProvider {
        fn model_name(&self) -> &str {
            "const"
        }
        fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
            Ok(texts.iter().map(|_| vec![1.0_f32, 0.0, 0.0]).collect())
        }
    }

    /// 在临时目录里建一个 notebook 并写两条 memo, 返回 (MemoFile, 配置).
    fn temp_notebook_with_memos() -> (tempfile::TempDir, MemoFile, Vec<NotebookConfig>) {
        let tmp = tempfile::tempdir().unwrap();
        let config_dir = tmp.path().join("config");
        let nb_dir = tmp.path().join("notebooks").join("work");
        std::fs::create_dir_all(nb_dir.join(".metadata")).unwrap();
        let mut mf = MemoFile::new(config_dir);
        let cfg = NotebookConfig {
            id: "work".into(),
            name: "work".into(),
            icon: None,
            path: format!("{}/", nb_dir.display()),
            is_default: true,
            sort: 0,
            created_at: 1,
            updated_at: 1,
        };
        mf.write_notebook_configs(&[cfg.clone()]).unwrap();
        mf.set_current_notebook(Some("work".into()));
        let mut svc = MemoService::new(&mut mf);
        svc.create_external_memo("work", "# Rustc\nrustc command not found")
            .unwrap();
        svc.create_external_memo("work", "# Weather\n今天天气很好")
            .unwrap();
        drop(svc);
        let configs = MemoService::new(&mf).list_notebooks().unwrap();
        (tmp, mf, configs)
    }

    fn entry(id: &str, filename: &str, body: &str, updated_at: i64) -> (MemoIndexEntry, String) {
        let entry = MemoIndexEntry {
            id: id.to_string(),
            filename: filename.to_string(),
            preview: "preview".to_string(),
            thumbnail: None,
            tags: vec![],
            todos: vec![],
            agents: vec![],
            created_at: updated_at,
            updated_at,
            favorited: false,
            icon: None,
            colors: vec![],
            properties: serde_json::json!({}),
        };
        let full_md = format!("---\nfilename: {}\n---\n{}", filename, body);
        (entry, full_md)
    }

    #[test]
    fn cosine_identical_is_one() {
        let v = vec![1.0, 2.0, 3.0];
        assert!((cosine_similarity(&v, &v) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn cosine_orthogonal_is_zero() {
        assert_eq!(cosine_similarity(&[1.0, 0.0], &[0.0, 1.0]), 0.0);
    }

    #[test]
    fn cosine_mismatched_length_is_zero() {
        assert_eq!(cosine_similarity(&[1.0], &[1.0, 0.0]), 0.0);
    }

    #[test]
    fn rrf_fuse_ranks_shared_doc_higher() {
        // docA 两路都是第 1, docB 只在一路第 1 → docA 应排前面.
        let run1 = vec!["a".into(), "b".into()];
        let run2 = vec!["a".into(), "c".into()];
        let fused = rrf_fuse(&[run1, run2], 60);
        assert_eq!(fused[0].0, "a");
        // a 的 fused 分 = 1/61 + 1/61, 高于 b/c 的 1/61
        assert!(fused[0].1 > 1.0 / 61.0 + 1e-6);
        assert_eq!(fused.len(), 3);
    }

    #[test]
    fn semantic_recall_finds_paraphrase_without_lexical_overlap() {
        // "编译器命令找不到" 在 bigram 词面下不会命中 "rustc command not found"
        // 这类英文笔记; 但语义向量 (共享大量字符) 应能召回.
        let provider = FakeProvider { dim: 256 };
        let query_vec = provider.embed_one("编译器命令找不到 rustc");

        let mut idx = SemanticIndex { vecs: HashMap::new() };
        idx.vecs
            .insert("m_en".into(), provider.embed_one("rustc command not found"));
        idx.vecs
            .insert("m_zh".into(), provider.embed_one("今天天气很好"));

        let mut ranked = idx.rank(&query_vec, 10);
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        assert_eq!(ranked[0].0, "m_en");
    }

    #[test]
    fn hybrid_search_recalls_when_lexical_cannot() {
        let (_tmp, mf, configs) = temp_notebook_with_memos();
        let query = "编译器命令找不到";

        // 纯 lexical: 中文同义查询与英文/中文 memo 都没有 bigram 重叠 → 0 命中.
        let lex = search_notebooks(&mf, &configs, None, query, 10);
        assert_eq!(
            lex.hits.len(),
            0,
            "lexical search must not match a synonym query with no surface overlap"
        );

        // hybrid: 尽管 lexical 失败, 语义层 (ConstProvider) 仍应把两条 memo 召回.
        let provider = ConstProvider;
        let hyb = search_notebooks_hybrid(
            &mf,
            &configs,
            None,
            query,
            10,
            SearchMode::Hybrid,
            &provider,
        )
        .unwrap();
        assert!(
            !hyb.hits.is_empty(),
            "hybrid search must recall memos via semantics even when lexical fails"
        );
        // 两条 memo 都该被语义召回.
        assert_eq!(hyb.hits.len(), 2);
    }

    #[test]
    fn semantic_only_mode_returns_semantic_hits() {
        let (_tmp, mf, configs) = temp_notebook_with_memos();
        let provider = ConstProvider;
        let res = search_notebooks_hybrid(
            &mf,
            &configs,
            None,
            "anything",
            10,
            SearchMode::Semantic,
            &provider,
        )
        .unwrap();
        assert_eq!(res.hits.len(), 2);
        // 仅语义召回的命中, matched_in 应为 Semantic, 不应是 Title/Tag/Body.
        for h in &res.hits {
            assert_eq!(h.matched_in, MatchField::Semantic);
        }
    }
}
