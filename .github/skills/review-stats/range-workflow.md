# Review Stats Range Workflow

Aggregate trend across a closed month range using only cached `data.json` files. **Never** fetches ADO data; if a month's `data.json` is missing, instruct the user to run the single-month workflow for that month first.

Entry: `/review-stats range <start> <end>` (both endpoints inclusive, after Step 0 normalization in [../../prompts/review-stats.prompt.md](../../prompts/review-stats.prompt.md)).

## Rules

1. **Read-only on raw**: this workflow never touches `raw/` or ADO MCP tools.
2. **Tool launch month = 2026-03**: clamp at Step 0 (prompt). Trend reports never include earlier months. (This is a start-of-data marker, not a comparison baseline.)
3. **Missing-month policy**: list missing `metrics/review-stats/<YYYY-MM>/data.json` files and ABORT with instructions to run the single-month workflow for each.

---

## Step 1: Enumerate months in range

Build `months[]` = every `YYYY-MM` from `start` to `end` inclusive (chronological). Reject empty range.

## Step 2: Load each month's data.json

For each `m` in `months[]`:

1. `path = metrics/review-stats/<m>/data.json`.
2. If absent: collect into `missing[]`.
3. If present: load JSON; extract:
   - `summary.{completed_prs, tool_reviewed_count, usage_rate, false_negative_rate, comment_effective_rate}`
   - `supporting.{action_items_per_pr, severity_distribution, author_coverage, multi_review_rate}`
   - `tool_reviewed_prs[].action_items[]` (filtered for `severity in [Bug, High]`, then split by `disposition`) -- needed by Step 4.
   - `exclusions.*`

If `missing[]` is non-empty: print missing list and ABORT. Do NOT emit a partial trend.

## Step 3: Compute deltas + aggregates

For each month after the first:

- `delta_usage_pct_points = usage_rate(m) - usage_rate(m-1)` in percentage points.
- Same shape for `comment_effective_rate`, `false_negative_rate`, `action_items_per_pr`.

Range aggregates (denominator-aware, NOT averages of rates):

- `range_usage_rate = sum(tool_reviewed_count) / sum(completed_prs)`
- `range_effective_rate = sum(effective_items) / sum(actionable_items)` -- requires re-deriving counts from each month's `tool_reviewed_prs[].action_items[].verdict`.
- `range_severity_totals = sum(severity_distribution[k]) for each k`
- `range_unique_authors` = union of authors across months (from `tool_reviewed_prs[].author`).

## Step 4: High-severity disposition retrospective

From `tool_reviewed_prs[].action_items[]` across the range, filter to `severity in [Bug, High]` and group by `disposition`:

1. **Not Adopted (open)** -- `disposition in {refused_disputed, refused_silent}`. Flat table: month / PR / author / file / description / disposition / rationale / follow_up. This is "what slipped past senior review attention" across the range.
2. **Refused but Accepted** -- `disposition in {refused_accepted, adopted_alt}`. Flat table same shape. Tracks reasoned consensus -- useful for spotting trends in "AI verdict vs human consensus".
3. **Adopted (full High+ surface)** -- `disposition in {adopted, adopted_concern}`. Flat table with `Reviewer follow-up` column (verified | silent | pushed-back). Surfaced for symmetry so the trend report shows the full High+ picture, not just the negative slice; also exposes adoptions where the reviewer never re-engaged.
4. **Items Needing Human Follow-up** -- `requires_human_review == true`. Compact table: month / PR / severity / file / disposition / one-line reason.

## Step 5: Write outputs

Output directory: `metrics/review-stats/range-<start>_<end>/` (mkdir if missing).

1. `trend.json` -- machine-readable: months[], per-month summary, deltas, range aggregates, high-sev-not-adopted[], high-sev-refused-accepted[], items-needing-human-review[].
2. `trend.md` -- human-readable, structured as:
   - Header (range + generated_at + repo)
   - Summary table: one row per month (Completed | Tool-reviewed | Usage% | Effective% | FN%)
   - Deltas table: month-over-month percentage-point changes
   - Range aggregates panel
   - **High-Severity Items Not Adopted (range)** -- per Step 4 (1)
   - **Refused but Accepted by Reviewer (range)** -- per Step 4 (2)
   - **High-Severity Items Adopted (range)** -- per Step 4 (3)
   - **Items Needing Human Follow-up (range)** -- per Step 4 (4)
   - Notes (e.g. "Months 2026-01 / 2026-02 excluded as pre-launch test data" if user-provided start was earlier)

Helper script: [tools/review-stats/aggregate-range.ps1](../../../../tools/review-stats/aggregate-range.ps1) does Steps 2-5 mechanically. Main agent's job is Step 0 normalization + invoking the script + presenting the result.

## Step 5.5: Emit Charts (Mermaid + HTML)

Read [charts.md](charts.md) for chart catalog. Run from repo root with `pwsh`:

```powershell
pwsh -NoProfile -File tools/review-stats/emit-mermaid-charts.ps1 -Start <YYYY-MM> -End <YYYY-MM>
pwsh -NoProfile -File tools/review-stats/render-html.ps1        -Start <YYYY-MM> -End <YYYY-MM>
```

First command appends a `<!-- charts:start --> ... <!-- charts:end -->` block to `trend.md` with all 9 Mermaid charts (6 time-series + severity pie + change-type pie + effective-by-bucket bar; idempotent). Second command writes `trend.html` (Chart.js dashboard with the same 9 charts; severity per-month rendered as a stacked bar instead of a pie of totals).

## Step 6: Done

Print paths to `trend.md`, `trend.json`, and `trend.html`.

---

## Flow Summary

```text
Step 0 (prompt): normalize start/end, clamp start to 2026-03
   v
Step 1: months[] = [start .. end]
   v
Step 2: load data.json for each month; abort if any missing
   v
Step 3: deltas + range aggregates
   v
Step 4: high-sev not-adopted retrospective across range
   v
Step 5: write trend.md + trend.json under range-<start>_<end>/
   v
Step 6: print paths
```
