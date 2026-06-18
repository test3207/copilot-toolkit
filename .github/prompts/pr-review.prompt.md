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
/pr-review review pr <prId or link>    - Review a specific PR
/pr-review my prs                      - List user's active PRs
```

## review pr Command

When user runs `/pr-review review pr <prId or link>`:

1. **Resolve input** (Step 0):
   - Compute `$toolkitRoot = if (Test-Path '.copilot-toolkit/.github') { '.copilot-toolkit/.github' } else { '.github' }` — every downstream skill / subagent receives this as `toolkit-root` so they can locate their own files at runtime.
   - Run `node .copilot-toolkit/scripts/parse-input.mjs "<input>"` to parse PR ID or URL (path assumes submodule / sync mount; if you self-host the toolkit by checking it out as the workspace root, drop the `.copilot-toolkit/` prefix).
   - **Registry-first**: read `.github/prompts/workflows/registry/index.md` (consumer-side) and try to match the repo. If matched, read `.github/prompts/workflows/registry/<matched-repo>.md` for full metadata — this is `repoContext` (registry mode; behaves exactly as before).
   - **Derive-fallback** (ONLY when no registry index exists, or no entry matches): build `repoContext` at runtime instead of stopping. This lets a consumer review a PR in its own single repo without authoring a registry entry.
     1. `node .copilot-toolkit/scripts/derive-repo-context.mjs "$(git --no-pager remote get-url origin)"` → `{ platform, org/project/repoName (ADO) | owner/repoName (GitHub/GitLab) }`. Set `pr-platform = platform` and `repo = repoName`. If `platform == unknown` (no `origin`, or unsupported host), STOP and ask the user to add a registry entry or a `.github/pr-review.json`.
     2. Set `path = .` (the workspace root IS the repo). `targetBranch` is taken from the PR object inside the skill (Step 1), not needed up front.
     3. Read optional consumer file `.github/pr-review.json` (repo root) for the non-derivable fields + overrides — see [SKILL.md](../skills/pr-review/SKILL.md) → *Optional `.github/pr-review.json`* for the schema. Any present field augments/overrides the derived values; an absent file means pure defaults.
     4. If `platform == ado` and no `repo-guid` was supplied, the skill resolves it via the provider's "get repo by name" recipe using the configured `ado-repo-server` (else the first ADO MCP server).
   - **Preflight (env doctor)**: run `node .copilot-toolkit/scripts/preflight.mjs --platform {repoContext.pr-platform} --mcp-configured <true|false>` (`true` when an `ado-repo-server` resolved). It probes node / git / the platform auth CLI (`az` or `gh`). If the report's `blocking` is non-empty (node, git, or the platform credential `az`/`gh` missing), STOP and print the `remediation` entries -- there is no offline mode. Otherwise set `repoContext.ado-access` (ADO) / `gh-access` (GitHub) = the explicit `.github/pr-review.json` value if present, else the report's `access.recommended`.
   - Both modes yield one `repoContext` object of the same shape the skill consumes.
2. **Invoke skill `pr-review`** with: `toolkit-root: $toolkitRoot`, `prId`, and `repoContext` (registry metadata OR derived): `path`, `targetBranch`, `pr-platform`, `ado-repo-server` + `repo-guid` if ADO, coding-standards list (registry list when present; else language-autodetected — see SKILL.md), anti-pattern allowlist.
3. Follow the skill's [SKILL.md](../skills/pr-review/SKILL.md) — it owns the workflow (Steps 0-9), provider seam, subagent dispatch, and PR-comment assembly.

## my prs Command

When user runs `/pr-review my prs`:

1. Read `.github/prompts/workflows/registry/index.md` to get all repos.
2. For each repo: read its registry entry, query `repo_list_pull_requests_by_repo_or_project` with `created_by_me: true` on the server named by registry `ado-repo-server`, using `repo-guid`.
3. Display combined PR list with repo name, ID, title, created date, status.
4. Prompt user to select a PR for review (then run `review pr` with the chosen id).
