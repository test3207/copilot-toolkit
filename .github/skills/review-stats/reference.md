# Review Stats Reference

JSON schema and Markdown report template. Read on-demand at workflow Step 8.

---

## data.json Schema

```jsonc
{
  "month": "YYYY-MM",
  "repo": "avd-portal",
  "generated_at": "ISO-8601 UTC timestamp",
  "tool_version": "v1.0",
  "summary": {
    "completed_prs": 0,
    "tool_reviewed_count": 0,
    "usage_rate": 0.0,
    "false_negative_rate": 0.0,
    "comment_effective_rate": 0.0
  },
  "exclusions": {
    "bot_pr_count": 0,
    "bot_pr_ids": [],
    "non_develop_pr_count": 0,
    "non_develop_pr_ids": [],
    "post_merge_only_pr_count": 0,
    "post_merge_only_pr_ids": [],
    "post_merge_comment_count": 0
  },
  "supporting": {
    "action_items_per_pr": 0.0,
    "severity_distribution": { "Bug": 0, "High": 0, "Medium": 0, "Low": 0, "Nit": 0, "Question": 0 },
    "author_coverage": { "tool_reviewed_authors": 0, "active_authors": 0, "ratio": 0.0 },
    "turnaround_hours_median": 0.0,
    "first_pass_approve_rate": 0.0,
    "change_type_distribution": { "Logic": 0, "Config": 0, "UI": 0, "Signature": 0, "API": 0, "unknown": 0 },
    "multi_review_rate": 0.0
  },
  "tool_reviewed_prs": [
    {
      "id": 12345,
      "title": "...",
      "author": "...",
      "createdDate": "...",
      "closedDate": "...",
      "tool_comment_published_date": "...",
      "verdict": "Approve | Approve with Comments | Request Changes",
      "change_type": "Logic | Config | UI | Signature | API | unknown",
      "multi_review_count": 1,
      "action_items": [
        {
          "severity": "Bug | High | Medium | Low | Nit | Question",
          "file": "path/to/file.ts",
          "description": "...",
          "verdict": "effective | not_effective | n/a",
          "disposition": "adopted | adopted_alt | adopted_concern | refused_accepted | refused_disputed | refused_silent | n/a",
          "rationale": "...",
          "follow_up": "Short text describing alt remedy / open work item / next step. Empty string if none.",
          "requires_human_review": false
        }
      ]
    }
  ],
  "discovered_false_negatives_this_month": [
    {
      "fix_pr_id": 12399,
      "introducing_pr_id": 12001,
      "introducing_pr_month": "YYYY-MM",
      "confidence": "high | medium | low",
      "rationale": "..."
    }
  ],
  "attributed_false_negatives": [
    {
      "fix_pr_id": 12399,
      "fix_pr_discovery_month": "YYYY-MM",
      "confidence": "high | medium | low",
      "rationale": "..."
    }
  ],
  "cross_month_writes": [
    "metrics/review-stats/YYYY-MM/data.json"
  ]
}
```

`attributed_false_negatives[]` is appended only by cross-month writes from later runs (where the discovering month attributes back to this month). Recompute `false_negative_rate = len(attributed_false_negatives) / tool_reviewed_count` whenever this list changes.

---

## report.md Template

```markdown
# Review Stats: {YYYY-MM} ({repo})

Generated: {ISO timestamp} | Tool: pr-review {tool_version}

## Summary

| Metric | Value |
|---|---|
| Completed PRs | {N} |
| Tool-reviewed PRs | {N} |
| **Usage rate** | {pct}% |
| **False-negative rate** | {pct}% (attributed: {count}) |
| **Comment effective rate** | {pct}% (effective: {N} / actionable: {N}) |

## Exclusions

| Filter | Count |
|---|---|
| PRs not targeting `develop` (release/hotfix/feature branches) | {N} |
| Bot-authored PRs (juno, GitFlow, etc.) | {N} |
| PRs with only post-merge tool comments (test data) | {N} |
| Post-merge comments dropped on otherwise-valid PRs | {N} |

## Supporting Metrics

| Metric | Value |
|---|---|
| Action items / PR (avg) | {N.N} |
| Severity distribution | Bug {N}, High {N}, Medium {N}, Low {N}, Nit {N}, Question {N} |
| Author coverage | {N} of {N} active authors ({pct}%) |
| Turnaround (median) | {N.N} hours |
| First-pass approve rate | {pct}% |
| Change type | Logic {N}, Config {N}, UI {N}, Signature {N}, API {N}, Unknown {N} |
| Multi-review rate | {pct}% |

## Tool-Reviewed PRs

| PR | Author | Verdict | Change Type | Items | Effective |
|---|---|---|---|---|---|
| !{id} {title} | {author} | {verdict} | {type} | {N} | {N}/{N} |

## High-Severity Items Not Adopted

Each `Bug` or `High` action item where `verdict == not_effective`. If empty: `_None._ Every Bug + High severity action item this month was adopted or acknowledged.`

For each item, render:

```markdown
### [{severity}] !{pr_id} -- {pr_title}

- **Author**: {author}
- **File**: {file}
- **Item**: {description}
- **Disposition**: {disposition} ({refused_disputed | refused_silent})
- **Rationale (why not adopted)**: {rationale}
- **Follow-up**: {follow_up or "_None recorded._"}
```

Note: items where `disposition == refused_accepted` or `refused_accepted_alt` are **not** listed here -- those are tracked under "Refused but Accepted by Reviewer" instead.

## Refused but Accepted by Reviewer

Each `Bug` or `High` action item where `disposition in {refused_accepted, adopted_alt}`. These are cases where the AI initial verdict would have been "not adopted" but the reviewer engaged in a follow-up dialogue and reached a reasoned consensus (alternative remedy, follow-up bug, design decision). Surfaced separately so trends in "AI judgment vs human consensus" are visible.

For each item:

```markdown
### [{severity}] !{pr_id} -- {pr_title}

- **Author**: {author}
- **File**: {file}
- **Item**: {description}
- **Disposition**: {disposition}
- **Resolution**: {rationale}
- **Follow-up**: {follow_up or "_None recorded._"}
```

If empty: `_None._ No Bug+High items were resolved via reviewer-accepted refusal this month.`

## High-Severity Items Adopted

Each `Bug`, `High`, or `Critical` action item where `disposition in {adopted, adopted_concern}`. Surfaced for symmetry with the refused sections so the report shows the full High+ surface, not just the negative slice. Items already covered by "Refused but Accepted by Reviewer" (`adopted_alt`) are NOT duplicated here.

This section answers: "of the items the author DID change, did the reviewer subsequently verify the fix?"

For each item:

```markdown
### [{severity}] !{pr_id} -- {pr_title}

- **Author**: {author}
- **File**: {file}
- **Item**: {description}
- **Disposition**: {disposition} (`adopted` = clean acceptance | `adopted_concern` = reviewer raised a new concern about the fix)
- **Reviewer follow-up**: {follow_up or "_None recorded._"} (verified | silent | pushed-back)
- **Rationale**: {rationale}
```

If empty: `_None._ No Bug+High+Critical items were adopted this month (likely no actionable High items reached, or all were refused).`

## Items Needing Human Follow-up

Each action item where `requires_human_review == true` (typically `Bug`/`High`/`Critical` with `disposition in {refused_disputed, refused_silent, adopted_concern}`). These are the items the AI cannot close out -- a senior reviewer / SRE / architect should look.

```markdown
| PR | Severity | File | Disposition | Why human review needed |
|---|---|---|---|---|
| !{pr_id} | {severity} | {file} | {disposition} | {one-line reason from rationale + follow_up} |
```

If empty: `_None._ All Bug + High items were either adopted or had a documented reviewer consensus.`

## False Negatives Discovered This Month

| Fix PR | Introducing PR | Introducing Month | Confidence | Rationale |
|---|---|---|---|---|
| !{fix_id} | !{intro_id} | {YYYY-MM} | {conf} | {short} |

## False Negatives Attributed to This Month (from later runs)

| Fix PR | Discovery Month | Confidence | Rationale |
|---|---|---|---|
| !{fix_id} | {YYYY-MM} | {conf} | {short} |

## Cross-Month Writes

- `metrics/review-stats/YYYY-MM/data.json` -- appended FN entry for fix PR !{id}

## Notes

- Usage rate denominator = all completed PRs in repo (no author filter).
- False-negatives attributed to the **introducing PR's closed month** -- this report is a moving target as later months add to it.
- Effective rate denominator excludes `Question` items.
```
