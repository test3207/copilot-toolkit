# Review Stats Charts Spec

Chart catalog and emit rules for the graph feature. Status: **active** (impl in `tools/review-stats/emit-mermaid-charts.ps1` + `tools/review-stats/render-html.ps1`).

Both report flavors emit charts:

- **Mermaid blocks** -- inline in `report.md` / `trend.md`. GitHub + ADO PR description render natively. Zero deps.
- **HTML dashboard** -- standalone `report.html` / `trend.html` with Chart.js (CDN). High-fidelity; does what Mermaid can't (stacked-per-month, multi-series legends, interactivity).

## Chart Catalog

T = time-series (range only -- skipped in single-month). C = categorical (both).

| # | Chart | Type | Mermaid block | HTML chart | Source |
|---|-------|------|---------------|------------|--------|
| 1 | Usage rate over time | T | `xychart-beta` line | line | `months[].usage_rate` |
| 2 | Effective rate over time | T | `xychart-beta` line | line | `months[].comment_effective_rate` |
| 3 | False-negative rate over time | T | `xychart-beta` line | line | `months[].false_negative_rate` |
| 4 | Completed vs Tool-reviewed | T | `xychart-beta` bar+line overlay | grouped bar | `months[].{completed_prs, tool_reviewed_count}` |
| 5 | Turnaround hours trend | T | `xychart-beta` line | line | `months[].turnaround_hours_median` |
| 6 | Author coverage trend | T | `xychart-beta` line (0..1 axis) | line | `months[].author_coverage_ratio` |
| 7 | Severity distribution | C | `pie` (totals across range) | stacked bar per month (range) / doughnut (single) | `severity_distribution` |
| 8 | Effective rate by severity bucket | C | `xychart-beta` bar (Bug+High, Medium, Low+Nit) | bar | `comment_effective_by_bucket` |
| 9 | Change-type distribution | C | `pie` (totals) | doughnut | `change_type_distribution` |

Single-month emits charts 7-9 only. Range emits all 9.

## Mermaid Templates

Line trend (charts 1, 2, 3, 5, 6):

```mermaid
xychart-beta
    title "<chart title>"
    x-axis [<month1>, <month2>, ...]
    y-axis "<label>" <ymin> --> <ymax>
    line [<v1>, <v2>, ...]
```

Bar+line overlay (chart 4):

```mermaid
xychart-beta
    title "Completed PRs vs Tool-reviewed"
    x-axis [<month1>, ...]
    y-axis "Count" 0 --> <max(completed)*1.1>
    bar [<completed1>, ...]
    line [<reviewed1>, ...]
```

Bar (chart 8):

```mermaid
xychart-beta
    title "Effective Rate by Severity Bucket"
    x-axis ["Bug+High", "Medium", "Low+Nit"]
    y-axis "Effective %" 0 --> 100
    bar [<bh_pct>, <m_pct>, <ln_pct>]
```

Pie (charts 7, 9): emit totals only; omit zero-value slices.

```mermaid
pie title <chart title>
    "<label1>" : <count1>
    "<label2>" : <count2>
```

Y-axis bounds rule: rates use `0 --> 100` (percent). Counts use `0 --> ceil(max * 1.1)`. Turnaround uses `0 --> ceil(max * 1.2)` (avoid clipping).

## HTML Dashboard

One self-contained file per report. Template at `tools/review-stats/templates/dashboard.html.tmpl` with placeholders `__TITLE__`, `__GENERATED_AT__`, `__MODE__` (`single` | `range`), `__DATA__` (entire `data.json` or `trend.json` as JSON).

Structure:

```html
<!DOCTYPE html><html><head>
  <meta charset="utf-8"><title>Review Stats -- __TITLE__</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>body{font-family:system-ui;margin:2em} .grid{display:grid;grid-template-columns:1fr 1fr;gap:2em} canvas{max-height:320px}</style>
</head><body>
  <h1>Review Stats -- __TITLE__</h1><p>Generated: __GENERATED_AT__ | Mode: __MODE__</p>
  <div class="grid">
    <canvas id="usage"></canvas><canvas id="effective"></canvas>
    <canvas id="fn"></canvas><canvas id="completedVsReviewed"></canvas>
    <canvas id="severity"></canvas><canvas id="effectiveBucket"></canvas>
    <canvas id="changeType"></canvas><canvas id="turnaround"></canvas>
    <canvas id="authorCoverage"></canvas>
  </div>
  <script>const DATA = __DATA__; const MODE = "__MODE__"; /* 9 chart inits; time-series hidden when MODE='single' */</script>
</body></html>
```

CDN: `chart.js@4.4.0` UMD build. No subresource integrity in v1; add later if shipped beyond local viewing.

## Schema Additions (trend.json)

`aggregate-range.ps1` must extend each `months[]` entry with the fields needed for charts 5, 6, 7 (per-month), 9 (per-month):

```jsonc
"months": [{
  // existing: month, completed_prs, tool_reviewed_count, usage_rate,
  //   comment_effective_rate, false_negative_rate, actionable_items,
  //   effective_items, action_items_per_pr
  "turnaround_hours_median": 0.0,
  "author_coverage_ratio": 0.0,
  "severity_distribution":   { "Bug":0, "High":0, "Medium":0, "Low":0, "Nit":0, "Question":0 },
  "change_type_distribution":{ "Logic":0, "Config":0, "UI":0, "Signature":0, "API":0, "unknown":0 }
}]
```

Pure additive -- existing readers are unaffected. `data.json` schema unchanged.

## Where Chart Emission Lives

| Output | Generator | Trigger |
|--------|-----------|---------|
| `report.md` Mermaid blocks (charts 7-9) | `compute-metrics-and-write.ps1` (extended) | single-month workflow Step 8 |
| `report.html` | `render-html.ps1 -Mode Single -Month <m>` | single-month workflow Step 8, after `report.md` |
| `trend.md` Mermaid blocks (all 9) | `aggregate-range.ps1` (extended) | range workflow Step 5 |
| `trend.html` | `render-html.ps1 -Mode Range -Start <s> -End <e>` | range workflow Step 5, after `trend.md` |

Mermaid emission stays inside the existing aggregator scripts (no new helper) -- chart blocks are simple string interpolation off in-memory data structures. HTML emission is split out because it needs templating + JSON embedding.

## Edge Cases

- **Single month + range chart**: time-series charts (1-6) are SKIPPED in single-month Mermaid output. Single-month HTML emits them anyway (single point/bar) -- the canvases are not hidden, just degenerate.
- **Zero-count buckets**: pie slices with value 0 are omitted to avoid Mermaid rendering glitches.
- **All-zero series**: emit the chart anyway with axis `0 --> 1` so the block still renders; add a note `_(no data this period)_` below.
- **Empty range** (no months): unreachable -- range-workflow.md aborts earlier if any month is missing.
