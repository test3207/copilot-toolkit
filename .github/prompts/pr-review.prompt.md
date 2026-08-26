---
description: "PR Review: review pr <prId> | my prs"
tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - browser
  - agent
  - todo
---

PR review entry point. The workflow body lives in skill [pr-review](../skills/pr-review/SKILL.md) — this prompt is a thin shim that resolves input and delegates.

## Usage

```
/pr-review review pr <prId or link>       - Review a specific PR (post-mode default: confirm)
/pr-review review pr <prId> --auto        - Unattended: post the review comment with no prompt
/pr-review review pr <prId> --confirm     - Force the confirm-before-post prompt (overrides local config)
/pr-review review pr <prId> --skip-post   - Never post; keep the local review artifacts only
/pr-review my prs                         - List user's active PRs
```

## review pr Command

When user runs `/pr-review review pr <prId or link>`:

1. **Resolve input** (Step 0) — full detail in [SKILL.md](../skills/pr-review/SKILL.md) → *Input Resolution (Step 0)*:
   - `$toolkitRoot = if (Test-Path '.copilot-toolkit/.github') { '.copilot-toolkit/.github' } else { '.github' }` — passed to every skill / subagent as `toolkit-root` so they locate their own files at runtime.
   - `node .copilot-toolkit/scripts/parse-input.mjs "<input>"` → PR ID or URL. (Self-hosting the toolkit at the workspace root: drop the `.copilot-toolkit/` prefix.)
   - **Registry-first**: match the repo in `.github/prompts/workflows/registry/index.md`; if matched, its `<repo>.md` entry is `repoContext` (registry mode).
   - **Derive-fallback** (no index / no match): `node .copilot-toolkit/scripts/derive-repo-context.mjs "$(git --no-pager remote get-url origin)"` → `{ platform, repoName, … }`; set `pr-platform`, `repo`, `path = .`; merge optional `.github/pr-review.json` overrides. `platform == unknown` → STOP and ask for a registry entry or `.github/pr-review.json`.
   - **Preflight**: `node .copilot-toolkit/scripts/preflight.mjs --platform {repoContext.pr-platform} --mcp-configured <true when an ado-repo-server resolved>`. Non-empty `blocking` (node / git / `az` / `gh`) → STOP with `remediation` (no offline mode). Else set `ado-access` / `gh-access` = `.github/pr-review.json` override, else `access.recommended`.
   - **Post-mode** (gates Step 9.2 posting): translate a `--auto` / `--confirm` / `--skip-post` flag on the command to `--post-mode auto|confirm|skip`, then `node .copilot-toolkit/scripts/pr-review-config.mjs resolve --repo-path {repoContext.path} [--post-mode <that>]`. Capture `postMode`; if the JSON reports `firstRun: true`, surface its `notice` once (three modes + the `auto` safety warning). Precedence: CLI flag > machine-local `.github/pr-review.local/config.json` > default `confirm`.
2. **Invoke skill `pr-review`** with `toolkit-root: $toolkitRoot`, `prId`, `post-mode` (resolved above), and the resolved `repoContext` (field list in SKILL.md).
3. Follow [SKILL.md](../skills/pr-review/SKILL.md) — it owns the workflow (Steps 0-9), provider seam, subagent dispatch, and PR-comment assembly.

## my prs Command

When user runs `/pr-review my prs`:

1. Read `.github/prompts/workflows/registry/index.md` to get all repos.
2. For each repo: read its registry entry, query `repo_list_pull_requests_by_repo_or_project` with `created_by_me: true` on the server named by registry `ado-repo-server`, using `repo-guid`.
3. Display combined PR list with repo name, ID, title, created date, status.
4. Prompt user to select a PR for review (then run `review pr` with the chosen id).
