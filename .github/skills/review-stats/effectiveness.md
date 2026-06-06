# Step 5: Comment Effectiveness (Subagent + Fast-Path)

Detailed sub-workflow for [workflow.md](workflow.md) Step 5.

**Goal**: minimize main-agent context. The subagent has terminal (`execute`) access and runs `git show` itself; the caller never sees git output. Most items skip the subagent entirely via fast-paths.

For each PR in `tool_reviewed_prs[]` with action items:

## 5a: Fast-path classification (NO subagent)

Before invoking the subagent, classify each item with these rules in order. Stop at the first match. Items that match a fast-path are written directly to `metrics/review-stats/<YYYY-MM>/scratch/effectiveness-<pr_id>.json` and the subagent is NOT called for them.

| Rule | Condition | Output |
| ---- | --------- | ------ |
| FP1 | `severity == 'Question'` | `verdict=n/a, disposition=n/a, follow_up='', requires_human_review=false, rationale='Question item'` |
| FP2 | `state == 'done'` AND `severity in [Low, Nit, Medium]` | `verdict=effective, disposition=adopted, follow_up='', requires_human_review=false, rationale='Author marked checkbox done [X]'` |
| FP3 | `state == 'open'` AND zero post-comment commits AND zero author replies in threads | `verdict=not_effective, disposition=refused_silent, follow_up='', requires_human_review=(severity in [Bug,High,Critical]), rationale='No commits, no author reply'` |

If ALL items in a PR match a fast-path, skip 5b entirely for that PR and proceed to the next PR.

**Implementation**: run `pwsh -NoProfile -File tools/review-stats/apply-fastpath-and-prep-subagent.ps1 -Month <YYYY-MM>` ONCE for the whole month -- it does the deterministic glue (count author replies, count post-comment commits, apply the 3 rules) and writes one `scratch/effectiveness-<pr_id>.json` per PR plus `scratch/items-<pr_id>.json` + `scratch/commits-<pr_id>.json` for any PR with pending items. Print the per-PR summary it emits as the only context cost.

## 5b: Subagent (only for unresolved items)

For PRs with at least one item NOT covered by fast-paths:

1. **Tool**: `repo_search_commits` to gather commit IDs+dates after `tool_comment_published_date`. Persist to `scratch/commits-<pr_id>.json` (caller drops content from context after persist).
2. Write the unresolved items array to `scratch/items-<pr_id>.json`.
3. Invoke subagent **review-stats-effective-checker** with paths only:
   - `pr_id`, `tool_comment_published_date`, `tool_identity_id`
   - `action_items_path` = `scratch/items-<pr_id>.json`
   - `post_comment_commit_ids[]` = list of SHAs (small inline array; subagent runs `git show` itself)
   - `thread_json_path` = `raw/threads-<pr_id>.json`
   - `repo_path` = avd-portal working dir
   - `output_path` = `scratch/effectiveness-<pr_id>-subagent.json`
4. Subagent returns ONE line (`wrote N items to <path>`). Caller does NOT read the subagent's analysis text -- the structured payload is on disk.
5. Caller merges the subagent JSON into `effectiveness-<pr_id>.json` (alongside any fast-path items).

## 5c: Per-PR flush (context discipline)

After each PR is processed, the caller MUST:

- Confirm `effectiveness-<pr_id>.json` exists with the expected item count.
- Drop the per-PR working data from active context (do not restate, summarize, or echo it). The next PR starts with a clean slate.
- Keep ONLY a 1-line progress log: `PR <id>: <N> items, <effective>/<actionable> effective (FP: <fp_count>, subagent: <sa_count>)`.

## 5d: Final assembly (after all PRs)

Run `pwsh -NoProfile -File tools/review-stats/merge-effectiveness.ps1 -Month <YYYY-MM>` ONCE -- it merges every `scratch/effectiveness-<pr>-subagent.json` into the matching `scratch/effectiveness-<pr>.json` (by item index) and patches `scratch/prs-enriched.json.actionItems[]` with `verdict` / `disposition` / `rationale` / `follow_up` / `requires_human_review`. Then `compute-metrics-and-write.ps1` reads `prs-enriched.json` to build `data.json` + `report.md`. See agent doc for the full disposition mapping table.

Compute `comment_effective_rate` = effective / (effective + not_effective). Question items excluded from denominator. The richer `disposition` field does NOT affect the rate -- it only feeds the report sections.
