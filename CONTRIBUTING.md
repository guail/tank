# Contributing to TANK 英雄笔记

TANK 是 Flowix 的 fork，改造为本地优先的 Markdown 笔记本。欢迎提交改进。

## Branch naming

`<type>/<short-kebab-summary>`. One branch = one logical change.

| Type        | When                                              | Example                           |
| ----------- | ------------------------------------------------- | --------------------------------- |
| `feat/`     | new feature visible to users                      | `feat/pdf-export`                 |
| `fix/`      | bug                                              | `fix/memo-search-tokenizer-crash` |
| `refactor/` | internal change with no user-visible behaviour    | `refactor/extract-skill-loader`   |
| `perf/`     | non-observable perf hot path                      | `perf/memo-index-query-cache`     |
| `chore/`    | tooling / deps / infra                           | `chore/bump-tauri-2.4`            |
| `docs/`     | docs only                                        | `docs/readme-rewrite`             |
| `test/`     | test-only change                                 | `test/cli-sidecar-fixtures`       |

Cut short summaries (≤ 5 words).

## Commit messages

Subject line ≤ 72 chars, imperative mood, no trailing period.

```
<scope>: <one-line summary>

Optional body explaining WHY. Wrap at 72 columns. Reference the issue
or PR with `#123`. Don't repeat what the diff says.
```

Common `<scope>` values used in this repo: `updater`, `dialog`, `cli`,
`docs`, `theme`, `memo`, `agent`, `i18n`, `export`.

Squash local noise before pushing.

## Pull requests

- Push the branch, open a PR against `main`.
- CI must be green before merge.
- Don't `force-push` after review. Use `git commit --fixup` and
  `git rebase --autosquash` if you must rebase.

### PR template

`.github/PULL_REQUEST_TEMPLATE.md` is what review comments attach to. Fill
its `## What` + `## Why` + `## How tested` sections even for "trivial"
changes.

## Releases

- `main` is the source of truth; every release is a tag on `main`.
- Tag format: `v<semver>` (e.g. `v1.1.49`).
- Tag → push → `.github/workflows/release.yml` builds the artifacts and
  publishes the GitHub release. Don't publish by hand.
- Hot-fix → patch release from a `fix/...` branch merged into `main`.

### Local manual release (override)

Sometimes a release has to be cut locally — for example, when the CI matrix
is missing a target, or when iterating on packaging before pushing a tag.

Tauri's own bundler produces the installer regardless of project config;
after `tauri build`, run the rename / upload scripts under `scripts/`:

```bash
# 1. Build packages for the target platform
./node_modules/.bin/tauri build

# 2. Upload to GitHub Releases via the allow-list script
./scripts/upload-release.sh v${VERSION} .build/release-${VERSION}
```

The rename and upload scripts read `version` from `app/Cargo.toml`, so
bump that (and `tauri.conf.json`) before building.

**Always use `scripts/upload-release.sh` for releases** — never `gh release
upload` directly. The script enforces an allow-list.

## Local workflow

```bash
git fetch origin
git switch -c feat/some-thing origin/main
# ... do work ...
git add -p        # stage hunks, not whole files
git commit -m "updater: ..."
git push -u origin feat/some-thing
gh pr create --base main
```

`git push` rules: never `git push --force` to `main` / `feat/*` if anyone
else may have branched off it; use `--force-with-lease` to detect drift.

## Secrets

- Never commit `.env`, signing keys, OAuth tokens, or local key files.
  `.gitignore` already guards the common spots.
- For local dev, use environment variables; never `git add` them.
- For CI, route through repository secrets
  (`Settings → Secrets and variables → Actions`).

## Code style

- Rust: `rustfmt` defaults; clippy is friend not foe.
- TypeScript / TSX: prettier + eslint (see `package.json`).
- Comments in source-of-truth files deserve real prose. Inline nitpicks
  live in commit messages and PR threads, not in the source.
