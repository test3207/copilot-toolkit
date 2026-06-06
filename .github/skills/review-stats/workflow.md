# Review Stats Workflow

Orchestration for `/review-stats <YYYY-MM>` and `/review-stats refresh <YYYY-MM>`. Detailed JSON schema + report template are in [reference.md](reference.md), loaded only at Step 8.

## Rules

1. **Cache-first**: every fetch checks `metrics/review-stats/<YYYY-MM>/raw/` before calling ADO. `refresh` mode deletes `raw/` first.
2. **Main agent owns all fetches**: subagents only read cached files.
3. **Cross-month writes are explicit**: when attributing a FN to a historical month, log the write path in the report.

---

## Step 1: Resolve Window

From `<YYYY-MM>`, compute `start = YYYY-MM-01T00:00:00Z`, `end = first day of next month T00:00:00Z`. Reject if `end > now`.

## Step 2: List Completed PRs in Window

**Tool**: `repo_list_pull_requests_by_repo_or_project`

Params: `repositoryId = <repo-guid>`, `status = completed`, sort by closed date desc. Page through all results. Filter to those with `closedDate` in `[start, end)`.

**Filter chain (apply in order, record exclusion counts for each)**:

1. **Target branch must be `develop`** -- drop any PR where `targetRefName != 'refs/heads/develop'`. Release branches, hotfix branches, etc. are out of scope. Record `excluded_non_develop_count`.
2. **Drop bot authors** -- drop any PR whose `createdBy.id` is in the registry `bot-identity-ids` list (juno translation, GitFlow, dependency bots, etc.). Bot PRs are not human-reviewable and would skew usage rate down. Record `excluded_bot_count`.

For each remaining PR, persist `metrics/review-stats/<YYYY-MM>/raw/pr-<id>.json` (skip write if cached and not in `refresh` mode).

Record `completed_prs[]` = `[{id, title, author, authorId, closedDate, createdDate, targetRefName}]`. Both exclusion counts surface in `data.json.exclusions` and the report's Exclusions table (transparency).

## Step 3: Fetch Threads + Identify Tool Reviews

For each PR in `completed_prs[]`:

1. **Tool**: `repo_list_pull_request_threads` -> save to `raw/threads-<id>.json`.
2. Scan thread comments for body matching regex `pr-review v\d+\.\d+`.
3. **Exclude post-merge comments (test data)**: drop any matching comment where `publishedDate > pr.closedDate`. Tool comments posted after the PR is completed are dry-run / test data, not real reviews.
4. If at least one pre-merge match remains: classify PR as `tool_reviewed = true`. Record:
   - `tool_comment_id` = id of the FIRST pre-merge match (chronological).
   - `tool_comment_published_date` = published date of that first match.
   - `tool_comment_body` = full body (needed by Step 5).
   - `multi_review_count` = count of pre-merge matches; `multi_review = true` if >1.
   - `excluded_post_merge_count` = count of post-merge matches dropped (for transparency).
5. If only post-merge matches exist: PR is NOT counted as tool-reviewed. Record `excluded_post_merge_only_pr_ids[]` for the report.
6. Append qualifying PRs to `tool_reviewed_prs[]`.

## Step 4: Parse Action Items + Intent

For each PR in `tool_reviewed_prs[]`, parse the latest tool comment body:

- **Action Items**: lines matching `- \[(?<box>[ Xx])\] \*\*\[(Bug|Bug potential|High|Medium|Low|Nit|Question)\]\*\*` -- extract: severity tag, file (between backticks), description, and a `state` field (`open` for `[ ]`, `done` for `[X]`/`[x]`). `state=done` means the author checked the box in the tool comment to indicate they addressed the item; downstream effectiveness logic auto-marks these as `effective` when no explicit subagent verdict is supplied.
- **Intent & Approach > Change Type**: regex `(?im)^\s*[*_]{0,2}\s*Change\s*Type\s*[*_]{0,2}\s*:\s*(.+)$` -- captures the value line (tolerating `**Change Type**:` / `__Change Type__:` markdown bolding around the field name), then scans the value for the first `(Config|UI|Signature|Logic|API)` bucket. Default `unknown` if absent. Combined values like `Logic/UI`, `Function Signature / API Contract`, `Config/Script` resolve to the first matching bucket.
- **Verdict**: regex `Verdict:?\s*\*?\*?(Approve|Approve with Comments|Request Changes)`.

Persist parsed structure inline in `tool_reviewed_prs[i]`.

## Step 5: Comment Effectiveness (Subagent + Fast-Path)

Detail in [effectiveness.md](effectiveness.md). Summary:

- **5a**: Run `pwsh -NoProfile -File tools/review-stats/apply-fastpath-and-prep-subagent.ps1 -Month <YYYY-MM>` ONCE. Applies 3 fast-path rules (FP1 Question, FP2 done+Low/Nit/Medium, FP3 silent refusal). Skips subagent for ~70% of items.
- **5b**: For PRs with at least one item NOT covered by fast-paths, invoke subagent **review-stats-effective-checker** with paths only (items file, threads file, commit SHAs, output path). Subagent returns 1-line ack.
- **5c**: After each PR, drop working data from context; keep 1-line progress log.
- **5d**: Run `pwsh -NoProfile -File tools/review-stats/merge-effectiveness.ps1 -Month <YYYY-MM>` ONCE to fold subagent verdicts back into `prs-enriched.json`. Then `compute-metrics-and-write.ps1` builds `data.json` + `report.md`.

`comment_effective_rate` = effective / (effective + not_effective). Question items excluded from denominator. The richer `disposition` field does NOT affect the rate -- it only feeds the report sections.

## Step 6: False-Negative Detection (Subagent)

Same paths-only contract as Step 5b. Subagent has `execute` and runs `git log` / `git blame` itself; caller never ingests git output.

1. Identify `fix_prs[]` from `completed_prs[]`: title or PR description contains keywords (`fix`, `bug`, `repair`, `incident`, `ICM`, `regression`) OR linked work item type is Bug.
2. Write `fix_prs[]` (with descriptions, diff summaries) to `scratch/fix-prs.json`. Write `tool_reviewed_pr_ids` (flat int array, all known months) to `scratch/tool-reviewed-pr-ids.json`.
3. Invoke subagent **review-stats-fn-detector** with paths only:
   - `fix_prs_path` = `scratch/fix-prs.json`
   - `tool_reviewed_pr_ids_path` = `scratch/tool-reviewed-pr-ids.json`
   - `repo_path` = avd-portal working dir
   - `cache_dir` = `metrics/review-stats/<YYYY-MM>/raw/`
   - `output_path` = `scratch/fn-findings.json`
4. Subagent returns ONE line (`wrote N findings to <path>`). Caller reads `scratch/fn-findings.json` -- a small JSON file -- not the chat message.
5. Filter to `was_tool_reviewed = true AND confidence >= medium` -> these are confirmed FNs.

## Step 7: Compute Supporting Metrics

From the structured records:

| Metric | Computation |
| ------ | ----------- |
| `usage_rate` | `len(tool_reviewed_prs) / len(completed_prs)` |
| `tool_reviewed_count` | `len(tool_reviewed_prs)` |
| `action_items_per_pr` | total action items / len(tool_reviewed_prs) |
| `severity_distribution` | bucket counts by severity tag |
| `author_coverage` | `unique(authors of tool_reviewed_prs)` and `/ unique(authors of completed_prs)` |
| `turnaround_hours` | per-PR (tool_comment_published - createdDate) in hours, then median |
| `first_pass_approve_rate` | tool-reviewed PRs with no commits between tool_comment_published and PR closed -> approve / tool-reviewed PRs (treat all-commits-before-comment PRs as N/A) |
| `change_type_distribution` | bucket counts by parsed Change Type |
| `multi_review_rate` | PRs with `multi_review=true` / tool-reviewed PRs |
| `comment_effective_rate` | from Step 5 |

**High-severity callouts (mandatory)**: from `tool_reviewed_prs[].action_items[]`, drive four report sections (`High-Severity Items Not Adopted`, `Refused but Accepted by Reviewer`, `High-Severity Items Adopted`, `Items Needing Human Follow-up`). Filter rules + render templates + empty placeholders are in [reference.md](reference.md) under the matching section headings.

## Step 8: Write Outputs

Read [reference.md](reference.md) for JSON schema and Markdown template.

1. Build `data.json` per schema. Path: `metrics/review-stats/<YYYY-MM>/data.json`.
2. Build `report.md` per template. Path: `metrics/review-stats/<YYYY-MM>/report.md`.
3. **Cross-month FN writes**: for each confirmed FN with `introducing_pr_month != <YYYY-MM>`:
   - Path: `metrics/review-stats/<introducing_pr_month>/data.json`.
   - If file exists: read, append `attributed_false_negatives[]` entry (dedup by `fix_pr_id`), recompute `false_negative_rate` if `tool_reviewed_count` is present.
   - If file absent: skip (only update months that already have a base report) and log a warning in the current report.
4. Print summary to user: counts, rates, list of cross-month files updated.

## Step 8.5: Emit Charts (Mermaid + HTML)

Read [charts.md](charts.md) for chart catalog. Run from repo root with `pwsh`:

```powershell
pwsh -NoProfile -File tools/review-stats/emit-mermaid-charts.ps1 -Month <YYYY-MM>
pwsh -NoProfile -File tools/review-stats/render-html.ps1        -Month <YYYY-MM>
```

First command appends a `<!-- charts:start --> ... <!-- charts:end -->` block to `report.md` with 3 categorical Mermaid charts (severity pie, change-type pie, effective-by-bucket bar). Re-running replaces the block (idempotent). Second command writes `report.html` (Chart.js dashboard with all 9 charts; time-series degenerate to a single point in single-month mode).

## Step 9: Done

Print paths to `metrics/review-stats/<YYYY-MM>/{report.md, report.html}`. Done.
