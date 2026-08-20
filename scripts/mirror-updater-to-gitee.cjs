#!/usr/bin/env node
'use strict';

// Mirror Tauri updater artifacts (latest.json + signed .zip) from the GitHub
// release to a *fixed* Gitee release tag ("updater"). Gitee has no mutable
// "latest" alias, so we overwrite the same tag every run. This lets clients
// with no GitHub access (e.g. behind GFW) fetch updates from Gitee.
//
// Driven by CI (release.yml). Best-effort: if GITEE_TOKEN is absent the script
// exits 0 so the GitHub release stays authoritative.
//
// Env:
//   GITEE_TOKEN          Gitee private token (repo write). Required.
//   GITEE_OWNER          Gitee owner (e.g. guail)
//   GITEE_REPO           Gitee repo  (e.g. tank)
//   GITHUB_REF_NAME      The pushed tag, e.g. v1.1.40
//   GITEE_DEFAULT_BRANCH Default branch on Gitee (used to create the mirror tag)

const fs = require('fs');
const path = require('path');

const OWNER = process.env.GITEE_OWNER;
const REPO = process.env.GITEE_REPO;
const TOKEN = process.env.GITEE_TOKEN;
const VERSION_TAG = process.env.GITHUB_REF_NAME; // v1.1.40
const DEFAULT_BRANCH = process.env.GITEE_DEFAULT_BRANCH || 'master';
const MIRROR_TAG = 'updater';
const API = `https://gitee.com/api/v5/repos/${OWNER}/${REPO}`;

if (!TOKEN) {
  console.log('[gitee-mirror] GITEE_TOKEN missing, skipping Gitee mirror.');
  process.exit(0);
}
if (!OWNER || !REPO || !VERSION_TAG) {
  console.error('[gitee-mirror] missing GITEE_OWNER / GITEE_REPO / GITHUB_REF_NAME');
  process.exit(1);
}

const withToken = (p) =>
  `${p}${p.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(TOKEN)}`;

async function api(method, p, opts = {}) {
  const res = await fetch(withToken(p), { method, ...opts });
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

function findUpdaterZip() {
  const root = path.resolve('app/target');
  const hits = [];
  (function walk(dir) {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.zip') &&
               full.replace(/\\/g, '/').includes('/bundle/')) {
        hits.push(full);
      }
    }
  })(root);
  // newest first; the updater zip is what we want
  return hits.sort((a, b) => b.localeCompare(a))[0];
}

async function main() {
  const zipPath = findUpdaterZip();
  if (!zipPath) {
    throw new Error('updater .zip not found under app/target/**/bundle/');
  }
  const zipName = path.basename(zipPath);
  console.log(`[gitee-mirror] updater zip: ${zipPath}`);

  // 1) Fetch the GitHub-generated latest.json for this version.
  const ghJsonUrl =
    `https://github.com/${OWNER}/${REPO}/releases/download/${VERSION_TAG}/latest.json`;
  console.log(`[gitee-mirror] fetching ${ghJsonUrl}`);
  const ghRes = await fetch(ghJsonUrl);
  if (!ghRes.ok) throw new Error(`fetch github latest.json -> ${ghRes.status}`);
  const manifest = await ghRes.json();

  // 2) Rewrite package URLs to the fixed Gitee mirror tag.
  const oldBase =
    `https://github.com/${OWNER}/${REPO}/releases/download/${VERSION_TAG}`;
  const newBase =
    `https://gitee.com/${OWNER}/${REPO}/releases/download/${MIRROR_TAG}`;
  for (const k of Object.keys(manifest.platforms || {})) {
    const p = manifest.platforms[k];
    if (p && typeof p.url === 'string' && p.url.startsWith(oldBase)) {
      p.url = newBase + p.url.slice(oldBase.length);
    }
  }
  const localJson = path.resolve('gitee-latest.json');
  fs.writeFileSync(localJson, JSON.stringify(manifest, null, 2));
  console.log(`[gitee-mirror] rewrote manifest package urls -> ${newBase}`);

  // 3) Create-or-get the fixed mirror release.
  let release;
  try {
    release = await api('POST', `${API}/releases`, {
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
    const m = String(e.message);
    if (m.includes('already exist') || m.includes('409') || m.includes('exist')) {
      console.log('[gitee-mirror] mirror release exists, fetching by tag');
      release = await api('GET', `${API}/releases/tags/${MIRROR_TAG}`);
    } else {
      throw e;
    }
  }

  // 4) Remove old assets so re-runs don't accumulate duplicates.
  try {
    const assets = await api(
      'GET',
      `${API}/releases/${release.id}/attach_files?per_page=100`
    );
    for (const a of assets || []) {
      if (a.name === 'latest.json' || a.name.endsWith('.zip')) {
        await api(
          'DELETE',
          `${API}/releases/${release.id}/attach_files/${a.id}`
        );
        console.log(`[gitee-mirror] deleted old asset ${a.name}`);
      }
    }
  } catch (e) {
    console.warn('[gitee-mirror] asset cleanup skipped:', e.message);
  }

  // 5) Upload the new manifest + zip (best-effort each).
  for (const f of [localJson, zipPath]) {
    try {
      const form = new FormData();
      form.append(
        'file',
        new Blob([fs.readFileSync(f)], { type: 'application/octet-stream' }),
        path.basename(f)
      );
      await api('POST', `${API}/releases/${release.id}/attach_files`, {
        body: form,
      });
      console.log(`[gitee-mirror] uploaded ${path.basename(f)}`);
    } catch (e) {
      console.warn(`[gitee-mirror] upload failed for ${path.basename(f)}:`, e.message);
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
