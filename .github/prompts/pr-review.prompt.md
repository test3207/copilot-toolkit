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
  # MCP server names below (ado-1, ado-2, incident-1, kusto-1) are neutral
  # placeholders. Configure your `.vscode/mcp.json` to match — see INSTALL.md
  # "MCP server naming convention". If you prefer real names, copy this prompt
  # to your own `.github/prompts/` and adjust the entries.
  #
  # ado-1: primary ADO org (repo, PRs, code search, pipelines)
  - ado-1/repo_get_repo_by_name_or_id
  - ado-1/repo_list_repos_by_project
  - ado-1/repo_get_pull_request_by_id
  - ado-1/repo_list_pull_requests_by_repo_or_project
  - ado-1/repo_list_pull_request_threads
  - ado-1/repo_list_pull_request_thread_comments
  - ado-1/repo_create_pull_request_thread
  - ado-1/repo_update_pull_request_thread
  - ado-1/repo_reply_to_comment
  - ado-1/repo_update_pull_request
  - ado-1/repo_search_commits
  - ado-1/search_code
  - ado-1/pipelines_get_build_status
  - ado-1/pipelines_get_build_log
  - ado-1/pipelines_get_build_log_by_id
  - ado-1/pipelines_get_builds
  # ado-2: secondary ADO org (cross-org work items, or repo ops for a second org)
  - ado-2/wit_get_work_item
  - ado-2/wit_get_work_items_batch_by_ids
  - ado-2/search_code
  - ado-2/wit_list_work_item_comments
  - ado-2/wit_add_work_item_comment
  - ado-2/repo_get_repo_by_name_or_id
  - ado-2/repo_get_pull_request_by_id
  - ado-2/repo_list_pull_requests_by_repo_or_project
  - ado-2/repo_list_pull_request_threads
  - ado-2/repo_list_pull_request_thread_comments
  - ado-2/repo_create_pull_request_thread
  - ado-2/repo_update_pull_request_thread
  - ado-2/repo_reply_to_comment
  - ado-2/repo_update_pull_request
  # incident-1: incident-management MCP server (optional, for bug-fix PRs)
  - incident-1/get_incident_details_by_id
  - incident-1/get_ai_summary
  # microsoft-docs: official Microsoft Learn docs MCP (optional)
  - microsoft-docs/microsoft_docs_search
  - microsoft-docs/microsoft_docs_fetch
  - microsoft-docs/microsoft_code_sample_search
---

PR review entry point. Owns the MCP `tools:` allowlist (above). The workflow body lives in skill [pr-review](../skills/pr-review/SKILL.md) — this prompt is a thin shim that resolves input and delegates.

## Usage

```
/pr-review review pr <prId or link>       - Review a specific PR (post-mode default: confirm)
/pr-review review pr <prId> --auto        - Unattended: post the review comment with no prompt
/pr-review review pr <prId> --confirm     - Force the confirm-before-post prompt (overrides local config)
/pr-review review pr <prId> --skip-post   - Never post; keep the local review artifacts only
/pr-review review pr <prId> --harness-profile <strict|standard|minimal>
                                          - How much model-capability scaffolding to load (default: strict)
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
   - **Post-mode + harness-profile** (one call): translate a `--auto` / `--confirm` / `--skip-post` flag on the command to `--post-mode auto|confirm|skip` and pass any `--harness-profile <strict|standard|minimal>` through, then `node .copilot-toolkit/scripts/pr-review-config.mjs resolve --repo-path {repoContext.path} [--post-mode <that>] [--harness-profile <that>]`. Capture `postMode` (gates Step 9.2 posting) and `harnessProfile` (selects the scaffolding tier the skill loads); if the JSON reports `firstRun: true`, surface its `notice` once (modes + profiles + the `auto` safety warning). Precedence for both: CLI flag > machine-local `.github/pr-review.local/config.json` > default (`confirm` / `strict`).
2. **Invoke skill `pr-review`** with `toolkit-root: $toolkitRoot`, `prId`, `post-mode` + `harness-profile` (resolved above), and the resolved `repoContext` (field list in SKILL.md).
3. Follow [SKILL.md](../skills/pr-review/SKILL.md) — it owns the workflow (Steps 0-9), provider seam, subagent dispatch, and PR-comment assembly.

## my prs Command

When user runs `/pr-review my prs`:

1. Read `.github/prompts/workflows/registry/index.md` to get all repos.
2. For each repo: read its registry entry, query `repo_list_pull_requests_by_repo_or_project` with `created_by_me: true` on the server named by registry `ado-repo-server`, using `repo-guid`.
3. Display combined PR list with repo name, ID, title, created date, status.
4. Prompt user to select a PR for review (then run `review pr` with the chosen id).
