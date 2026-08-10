//! Ollama embedding provider for tank-cli.
//!
//! 实现 `tank_core::embed::EmbeddingProvider`, 走本地 Ollama 的
//! `/api/embed` HTTP 端点. 复用工作区已有的 `reqwest` (blocking) 客户端,
//! 自带 tokio 运行时, 不需要 tank-cli 自身引入 async 执行模型.

use tank_core::embed::EmbeddingProvider;

/// 基于本地 Ollama 的 embedding 后端.
///
/// 默认端点 `http://localhost:11434`, 模型 `nomic-embed-text`, 可通过环境变量
/// `TANK_OLLAMA_URL` / `TANK_EMBED_MODEL` 覆盖 (见 `store::search_hits`).
pub struct OllamaEmbeddingProvider {
    url: String,
    model: String,
    client: reqwest::blocking::Client,
}

impl OllamaEmbeddingProvider {
    pub fn new(url: &str, model: &str) -> Self {
        Self {
            url: url.trim_end_matches('/').to_string(),
            model: model.to_string(),
            client: reqwest::blocking::Client::new(),
        }
    }
}

impl EmbeddingProvider for OllamaEmbeddingProvider {
    fn model_name(&self) -> &str {
        &self.model
    }

    fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let endpoint = format!("{}/api/embed", self.url);
        let payload = serde_json::json!({ "model": self.model, "input": texts });
        let resp = self
            .client
            .post(&endpoint)
            .json(&payload)
            .send()
            .map_err(|e| format!("ollama request to {endpoint} failed: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().unwrap_or_default();
            return Err(format!("ollama returned {status}: {body}"));
        }
        let value: serde_json::Value = resp
            .json()
            .map_err(|e| format!("ollama response decode failed: {e}"))?;
        let embeddings = value
            .get("embeddings")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "ollama response missing `embeddings` array".to_string())?;
        let mut out = Vec::with_capacity(texts.len());
        for e in embeddings {
            let vec: Vec<f32> = e
                .as_array()
                .ok_or_else(|| "embedding entry is not an array".to_string())?
                .iter()
                .map(|x| x.as_f64().unwrap_or(0.0) as f32)
                .collect();
            out.push(vec);
        }
        if out.len() != texts.len() {
            return Err(format!(
                "ollama returned {} embeddings for {} inputs",
                out.len(),
                texts.len()
            ));
        }
        Ok(out)
    }
}
