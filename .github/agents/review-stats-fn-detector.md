---
name: review-stats-fn-detector
description: False-negative retro analysis - infer introducing PR from fix PR
tools: ['read', 'search', 'execute']
user-invocable: false
---

# Review Stats False-Negative Detector

For each fix PR in the month, infer the introducing PR (the PR that introduced the bug being fixed) and check whether the introducing PR was tool-reviewed. If yes -> false negative.

## Input (slim contract)

Caller passes ONLY paths + IDs -- never inline diff text or PR descriptions:

- `fix_prs_path` -- file containing the fix PRs array `[{id, title, description, diff_summary, linked_wi_ids[]}]`. Subagent reads it.
- `tool_reviewed_pr_ids_path` -- file containing the flat array of all known tool-reviewed PR ids (across months). Subagent reads it.
- `repo_path` -- avd-portal working dir. Subagent runs `git log`, `git blame`, `git show` itself via `execute`. Output never flows through the caller.
- `cache_dir` -- `metrics/review-stats/<YYYY-MM>/raw/` for cached PR JSON of historical months when available.
- `output_path` -- file the subagent MUST write its findings to (JSON, schema below).

**Why these constraints**: same as effective-checker. Caller's context per fix PR drops to ~3 lines (paths + 1-line ack) instead of ingesting diff summaries + git blame output + a markdown table back.

## Task

**Terminal safety (HARD RULE)**: every git invocation in this agent MUST go through `tools/run-safe.ps1` (or pass `--no-pager` and never use a pager-paginated subcommand). The terminal tool cannot recover from a pager / Read-Host / credential prompt; the wrapper enforces hard timeout + closed stdin + `GIT_PAGER=cat` + `GIT_TERMINAL_PROMPT=0`. Example:

```pwsh
pwsh -File tools/run-safe.ps1 -Command "git -C <repo_path> --no-pager log --oneline -50 -- <file>" -TimeoutSec 15
pwsh -File tools/run-safe.ps1 -Command "git -C <repo_path> --no-pager blame -L <start>,<end> -- <file>" -OutputFile <scratch>/blame-<sha>.txt -TimeoutSec 30
```

For each fix PR:

### 1. Read description + linked WI

- Parse PR description for explicit `introduced by !XXXXX` / `regressed by !XXXXX` / `caused by !XXXXX` mentions. If found: `introducing_pr_id` = parsed value, `confidence = high`. Skip to step 4.
- If linked WI exists, the caller may have included WI summary in the description. Look for "introduced by" / "caused by" in there too.

### 2. Diff-based inference (when no explicit pointer)

- Pick the 1-3 most-modified files from `diff_summary`.
- For each, run `git log --oneline -- <file>` (last ~50 commits) in `repo_path`.
- Read recent commits' messages: those that look like the original feature/refactor introducing the buggy behavior.
- If a candidate commit's message references a PR id (`Merged PR XXXXX`), capture it.

### 3. Confidence scoring

| Signal | Confidence |
|---|---|
| Explicit "introduced by !N" in fix PR or WI | `high` |
| Single dominant commit identified by blame on the actually-changed lines | `medium` |
| Multiple candidate PRs / unclear ownership | `low` |
| No candidate found | `unverifiable` (skip output for this fix PR) |

### 4. Tool-review check

Look up `introducing_pr_id` in `tool_reviewed_pr_ids`. Set `was_tool_reviewed = true|false`.

### 5. Introducing month

If `introducing_pr_id` found: read its closed date. Prefer `cache_dir/raw/pr-<id>.json` if cached; otherwise note `month_unknown = true` (the caller will fill this in by fetching PR metadata).

## Output Format

Write a JSON file at `output_path`, then return ONE line: `wrote N findings to <output_path>`.

```json
{
  "findings": [
    {
      "fix_pr_id": 12399,
      "introducing_pr_id": 12001,
      "introducing_pr_month": "2026-01",
      "month_source": "cache",
      "was_tool_reviewed": true,
      "confidence": "high",
      "rationale": "introduced by !12001 in fix PR desc"
    }
  ]
}
```

Skip `unverifiable` entries from the JSON (caller does not need them). Use `"introducing_pr_month": "unknown"` and `"month_source": "unknown"` if cache missing.

**Output discipline (HARD RULE)**:
- Chat-message return MUST be a single line: `wrote N findings to <output_path>`.
- All structured analysis goes into the JSON file. No table, no preamble, no diff/blame text in the return.
- On failure, return ONE line: `error: <short reason>`.

## Rules

- **Never call ADO MCP directly** -- caller fetched everything; use only cache + git.
- **Never make up PR ids**. If unsure, mark `unverifiable`.
- Keep total output <100 lines.
