---
description: "Review Stats: monthly PR-review metrics"
tools:
  - read
  - edit
  - execute
  - search
  - agent
  - todo
  # MCP server names below (ado-1, ado-2) are neutral placeholders. Configure
  # your `.vscode/mcp.json` to match — see INSTALL.md "MCP server naming
  # convention". If you prefer real names, copy this prompt locally and adjust
  # the entries.
  #
  # ado-1: ADO org that hosts the reviewed PRs (threads, commits)
  - ado-1/repo_get_repo_by_name_or_id
  - ado-1/repo_get_pull_request_by_id
  - ado-1/repo_list_pull_requests_by_repo_or_project
  - ado-1/repo_list_pull_request_threads
  - ado-1/repo_search_commits
  # ado-2: ADO org that hosts work items linked from PR descriptions (cross-org)
  - ado-2/wit_get_work_item
  - ado-2/wit_get_work_items_batch_by_ids
  - ado-2/wit_list_work_item_comments
agents:
  - review-stats-effective-checker
  - review-stats-fn-detector
---

Review-stats entry point. Owns the MCP `tools:` allowlist + agent allowlist. The workflow body lives in skill [review-stats](../skills/review-stats/SKILL.md) — this prompt is a thin shim that resolves input and delegates.

## Commands

```text
/review-stats <month>                     - Generate metrics for a completed month
/review-stats refresh <month>             - Re-fetch raw data and recompute
/review-stats range <start> <end>         - Aggregate trend across a month range (cached data.json only — no ADO fetch)
```

`<month>` accepts any of the following forms (all normalized to `YYYY-MM` internally):

| Input | Resolves to | Notes |
| ----- | ----------- | ----- |
| `2604` | `2026-04` | 4-digit `YYMM` — year = `20` + first 2 digits |
| `202604` | `2026-04` | 6-digit `YYYYMM` |
| `2026-04` | `2026-04` | Canonical |
| `2026/04` | `2026-04` | Slash separator |
| `04` | `<currentYear>-04` | 2-digit `MM` — assumes current year (reject if month is future) |

Range examples: `/review-stats range 2603 2604`, `/review-stats range 2026-03 2026-05`. Both endpoints inclusive.

## Consumer Config (per-consumer; override locally)

| Item | Default |
| ---- | ------- |
| Default repo | The first repo entry in `.github/prompts/workflows/registry/index.md`, or the repo the consumer copies this prompt to specify. |
| Tool launch month | The month the consumer first deployed PR-review with intent to ship. Earlier months may contain test/dry-run data and MUST NOT be included in trend reports. **Not** a comparison baseline. |

## Input Resolution (Step 0)

When user runs `/review-stats …`:

1. **Resolve toolkit root**: compute `$toolkitRoot = if (Test-Path '.copilot-toolkit/.github') { '.copilot-toolkit/.github' } else { '.github' }` — passed to the skill so subagents can locate `{toolkit-root}/skills/review-stats/...` files at runtime.
2. **Parse args**:
   - `[refresh] <month>` → single-month mode (`mode=single` or `mode=refresh`).
   - `range <start> <end>` → range mode (`mode=range`).
   Normalize each `<month>` to canonical `YYYY-MM` per the Commands table above. Reject malformed input.
3. **Validate**: reject if any normalized `<YYYY-MM>` is the current or a future month (need fully-closed PRs).
4. **Tool-launch clamp**: for `range` mode, if `start < <toolLaunchMonth>`, warn and clamp `start = <toolLaunchMonth>`. Reject if `start > end`.
5. **Read registry**: load `.github/prompts/workflows/registry/<default-repo>.md` for `repo-guid`, ADO `project` / `area-path`, `bot-identity-ids`, and the local checkout path.
6. **Ensure scratch dir** for single-month: `metrics/review-stats/<YYYY-MM>/raw/` exists (mkdir).
7. **Invoke skill `review-stats`** with: `toolkit-root: $toolkitRoot`, `mode`, `month` (or `start`+`end`), matched `repo`, full registry metadata, `toolLaunchMonth`. Follow the skill's [SKILL.md](../skills/review-stats/SKILL.md) — it owns the todo plan, workflow dispatch, subagent contracts, schema, and report templates.
