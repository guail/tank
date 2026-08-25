#!/usr/bin/env node
'use strict';

// Mirror Tauri updater artifacts (latest.json + the per-platform update
// bundle, e.g. the NSIS .exe) from the GitHub release to a *fixed* Gitee
// release tag ("updater"). Gitee has no mutable "latest" alias, so we
// overwrite the same tag every run. This lets clients with no GitHub access
// (e.g. behind GFW) fetch updates from Gitee.
//
// Tauri v2 NSIS updater: latest.json's platform `url` points at
//   https://api.github.com/repos/<o>/<r>/releases/assets/<assetId>
// (a redirect URL, not a clean /releases/download/... path) and the asset
// is the NSIS setup .exe itself (no separate .zip). We resolve each asset's
// real filename via the GitHub API, download the binary, rewrite the url to
// the Gitee mirror, then upload both latest.json and the binary to Gitee.
//
// Driven by CI (release.yml). Best-effort: if GITEE_TOKEN is absent the
// script exits 0 so the GitHub release stays authoritative.
//
// Env:
//   GITEE_TOKEN          Gitee private token (repo write). Required.
//   GITEE_OWNER          Gitee owner (e.g. guail)
//   GITEE_REPO           Gitee repo  (e.g. tank)
//   GITHUB_REF_NAME      The pushed tag, e.g. v1.1.40
//   GITEE_DEFAULT_BRANCH Default branch on Gitee (used to create the mirror tag)
//   GITHUB_TOKEN         Optional; used for GitHub API auth (public repos work without)

const fs = require('fs');
const path = require('path');

const OWNER = process.env.GITEE_OWNER;
const REPO = process.env.GITEE_REPO;
// Gitee URL path MUST use the account username (guail), not the display name.
const GH_OWNER = process.env.GITHUB_OWNER || OWNER;
const GH_REPO = process.env.GITHUB_REPO || REPO;
const TOKEN = process.env.GITEE_TOKEN;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const VERSION_TAG = process.env.GITHUB_REF_NAME; // v1.1.40
const DEFAULT_BRANCH = process.env.GITEE_DEFAULT_BRANCH || 'master';
const MIRROR_TAG = 'updater';
const GITEE_API = `https://gitee.com/api/v5/repos/${OWNER}/${REPO}`;
const GH_API = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}`;

if (!TOKEN) {
  console.log('[gitee-mirror] GITEE_TOKEN missing, skipping Gitee mirror.');
  process.exit(0);
}
if (!OWNER || !REPO || !VERSION_TAG) {
  console.error('[gitee-mirror] missing GITEE_OWNER / GITEE_REPO / GITHUB_REF_NAME');
  process.exit(1);
}
if (!GH_OWNER || !GH_REPO) {
  console.error('[gitee-mirror] missing GITHUB_OWNER / GITHUB_REPO');
  process.exit(1);
}

const ghHeaders = () => ({
  ...(GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {}),
});

async function giteeApi(method, p, opts = {}) {
  const sep = p.includes('?') ? '&' : '?';
  // 大文件上传 (NSIS .exe ~19MB) 在 CI 上偶发连接抖动，给每次请求一个
  // 上限超时，避免 fetch 无限挂起；配合调用方的重试逻辑覆盖瞬时失败。
  // 上传走 multipart 时超时给更宽松的预算（10 分钟），避免 18.7MB 的
  // exe 在 Gitee 上还没传完就被掐断（原 180s 在慢速 CI 上会反复 aborted）。
  const isUpload = Boolean(opts && opts.body && typeof opts.body.getBoundary === 'function');
  // 大文件上传 (NSIS .exe ~19MB) 在 CI 上偶发连接抖动：给上传更宽松的预算
  // (15 分钟)，避免 10 分钟仍不够时被掐断。普通请求保持 3 分钟上限。
  const budget = isUpload ? 900000 : 180000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budget);
  let res;
  try {
    res = await fetch(`${p}${sep}access_token=${encodeURIComponent(TOKEN)}`, {
      method,
      ...opts,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || res.status;
    throw new Error(`${method} ${p} -> ${res.status}: ${msg}`);
  }
  return data;
}

// Resolve a GitHub asset url (api.github.com/.../assets/<id>) to its binary
// buffer + filename, and compute the rewritten Gitee url.
async function resolveGithubAsset(url) {
  const m = String(url).match(
    /api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/assets\/(\d+)/
  );
  let filename;
  if (m) {
    const assetId = m[1];
    const meta = await fetch(`${GH_API}/releases/assets/${assetId}`, {
      headers: { Accept: 'application/vnd.github+json', ...ghHeaders() },
    }).then((r) => r.json());
    filename = meta.name;
    if (!filename) throw new Error(`cannot resolve asset ${assetId} name`);
  } else {
    // fallback: clean /releases/download/<tag>/<file> path
    const base = `https://github.com/${GH_OWNER}/${GH_REPO}/releases/download/${VERSION_TAG}`;
    if (!String(url).startsWith(base)) return null;
    filename = String(url).split('/').pop();
  }
  const binRes = await fetch(
    m
      ? `${GH_API}/releases/assets/${m[1]}`
      : String(url),
    { headers: { Accept: 'application/octet-stream', ...ghHeaders() } }
  );
  if (!binRes.ok) throw new Error(`download ${filename} -> ${binRes.status}`);
  const buf = Buffer.from(await binRes.arrayBuffer());
  const giteeUrl = `https://gitee.com/${OWNER}/${REPO}/releases/download/${MIRROR_TAG}/${encodeURIComponent(
    filename
  )}`;
  return { filename, buf, giteeUrl };
}

async function main() {
  // 1) Fetch the GitHub-generated latest.json for this version.
  const ghJsonUrl = `https://github.com/${GH_OWNER}/${GH_REPO}/releases/download/${VERSION_TAG}/latest.json`;
  console.log(`[gitee-mirror] fetching ${ghJsonUrl}`);
  const ghRes = await fetch(ghJsonUrl);
  if (!ghRes.ok) throw new Error(`fetch github latest.json -> ${ghRes.status}`);
  const manifest = await ghRes.json();

  // 2) Resolve + rewrite each platform's package url, collect binaries.
  const binaries = []; // { filename, buf }
  for (const k of Object.keys(manifest.platforms || {})) {
    const p = manifest.platforms[k];
    if (!p || typeof p.url !== 'string') continue;
    const resolved = await resolveGithubAsset(p.url);
    if (!resolved) {
      console.log(`[gitee-mirror] skipping platform ${k} (unrecognized url ${p.url})`);
      continue;
    }
    p.url = resolved.giteeUrl;
    binaries.push(resolved);
    console.log(`[gitee-mirror] platform ${k} -> ${resolved.filename} (${(resolved.buf.length / 1024 / 1024).toFixed(1)}MB)`);
  }
  if (binaries.length === 0) {
    throw new Error('no platform binaries resolved from latest.json');
  }

  const localJson = path.resolve('latest.json');
  fs.writeFileSync(localJson, JSON.stringify(manifest, null, 2));
  console.log(`[gitee-mirror] rewrote manifest package urls -> gitee tag '${MIRROR_TAG}'`);

  // 3) Create-or-get the fixed mirror release.
  let release;
  try {
    release = await giteeApi('POST', `${GITEE_API}/releases`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: MIRROR_TAG,
        name: `Updater Mirror (${MIRROR_TAG})`,
        body: `Auto-mirrored Tauri updater manifest + artifacts. Current: ${VERSION_TAG}.`,
        target_commitish: DEFAULT_BRANCH,
        prerelease: false,
        draft: false,
      }),
    });
    console.log(`[gitee-mirror] created mirror release id=${release.id}`);
  } catch (e) {
    const msg = String(e.message);
    // Gitee returns 400/409 with either English ("already exist") or Chinese
    // ("该标签已经存在发行版") when the mirror tag already has a release.
    // Also treat a plain 400 during creation as "exists" here, since the
    // only creation we do is the fixed 'updater' tag that we pre-create once.
    const existsLike =
      msg.includes('already exist') ||
      msg.includes('exist') ||
      msg.includes('409') ||
      msg.includes('400') ||
      msg.includes('已经存在');
    if (existsLike) {
      console.log('[gitee-mirror] mirror release exists, fetching by tag');
      release = await giteeApi('GET', `${GITEE_API}/releases/tags/${MIRROR_TAG}`);
    } else {
      throw e;
    }
  }

  // 4) List current assets once (used for skip-if-exists + later cleanup).
  let existing = [];
  try {
    existing = (await giteeApi(
      'GET',
      `${GITEE_API}/releases/${release.id}/attach_files?per_page=100`
    )) || [];
  } catch (e) {
    console.warn('[gitee-mirror] list assets failed:', e.message);
  }
  const existingByName = new Map(existing.map((a) => [a.name, a]));

  // 5) Upload the NEW binaries FIRST, WITHOUT deleting the previous ones.
  //    A flaky upload can therefore never leave the mirror without a usable
  //    exe — clients simply keep updating to the last good version instead of
  //    hitting a 404. Gitee appends on same name, so we skip if it's already up.
  let exeOk = true;
  for (const b of binaries) {
    const name = b.filename;
    if (existingByName.has(name)) {
      console.log(`[gitee-mirror] ${name} already on Gitee, skip`);
      continue;
    }
    fs.writeFileSync(path.resolve(name), b.buf);
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const form = new FormData();
        form.append(
          'file',
          new Blob([fs.readFileSync(path.resolve(name))], { type: 'application/octet-stream' }),
          name
        );
        await giteeApi('POST', `${GITEE_API}/releases/${release.id}/attach_files`, {
          body: form,
        });
        console.log(`[gitee-mirror] uploaded ${name}`);
        ok = true;
      } catch (e) {
        console.warn(`[gitee-mirror] upload attempt ${attempt} failed for ${name}:`, e.message);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 8000));
      }
    }
    if (!ok) {
      console.error(`[gitee-mirror] could NOT upload ${name} after 3 attempts`);
      exeOk = false;
    }
  }

  // 6) Only swap latest.json + clean stale assets AFTER the exe is confirmed up.
  //    If the upload failed we leave Gitee on the previous working version so
  //    clients keep updating (never a 404). We retry on the next release run.
  if (!exeOk) {
    console.warn(
      '[gitee-mirror] new binary not mirrored; leaving Gitee on the previous working version so clients keep updating. Retry next release.'
    );
    console.log(
      `[gitee-mirror] done (degraded). manifest: https://gitee.com/${OWNER}/${REPO}/releases/download/${MIRROR_TAG}/latest.json`
    );
    return;
  }

  // 6a) Replace latest.json. Gitee appends on same name, so delete ALL existing
  //     copies first, then upload the rewritten one.
  for (const a of existing) {
    if (a.name === 'latest.json') {
      await giteeApi(
        'DELETE',
        `${GITEE_API}/releases/${release.id}/attach_files/${a.id}`
      ).catch(() => {});
      console.log('[gitee-mirror] deleted old latest.json');
    }
  }
  fs.writeFileSync(path.resolve('latest.json'), JSON.stringify(manifest, null, 2));
  {
    const form = new FormData();
    form.append(
      'file',
      new Blob([fs.readFileSync(path.resolve('latest.json'))], { type: 'application/json' }),
      'latest.json'
    );
    await giteeApi('POST', `${GITEE_API}/releases/${release.id}/attach_files`, { body: form });
  }
  console.log('[gitee-mirror] uploaded latest.json');

  // 6b) Remove stale exes (anything not the current version) to avoid bloat.
  const currentExes = new Set(binaries.map((b) => b.filename));
  for (const a of existing) {
    if (/\.exe$/.test(a.name) && !currentExes.has(a.name)) {
      await giteeApi(
        'DELETE',
        `${GITEE_API}/releases/${release.id}/attach_files/${a.id}`
      ).catch((e) => console.warn('[gitee-mirror] cleanup skip', a.name, e.message));
      console.log(`[gitee-mirror] removed stale ${a.name}`);
    }
  }

  console.log(
    `[gitee-mirror] done. manifest: https://gitee.com/${OWNER}/${REPO}/releases/download/${MIRROR_TAG}/latest.json`
  );
}

main().catch((e) => {
  console.error('[gitee-mirror] FAILED:', e.message);
  process.exit(1);
});
