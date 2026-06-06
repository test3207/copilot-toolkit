---
name: review-stats
description: Monthly metrics for a PR-review tool — usage rate, false-negative rate, comment effectiveness, plus supporting indicators. Single-month and range-trend workflows; cache-first; main agent owns all ADO fetches, subagents read cached files only. Use when asked to compute, refresh, or aggregate review-tool metrics for a repo.
user-invocable: false
---

# Review Stats

Monthly metrics for the `pr-review` tool against a repo: usage rate, false-negative rate, comment effectiveness, plus supporting indicators (severity distribution, change-type distribution, turnaround, author coverage, first-pass approve, multi-review). Cache-first; main agent owns all ADO fetches; two read-only subagents handle effectiveness classification and FN detection.

## When to use this skill

- The caller says "compute review-stats for <month>", "refresh review-stats <month>", or "review-stats range <start> <end>", or runs `/review-stats …`.
- The caller's entry prompt has set up the MCP tool allowlist (this skill itself declares no `tools`; the consuming prompt owns the allowlist).
- The consumer has a registry entry for the target repo containing `repo-guid`, ADO project / area-path, and `bot-identity-ids`.

When NOT to use it:

- The repo is not present in the consumer's registry — ask the caller to onboard it via `/onboard-repo` first.
- The target month is the current or a future month (rejected; need fully-closed PRs).
- The caller wants per-author metrics across a team rather than per-tool metrics — that's a separate `team-review-stats` workflow, not this skill.

## Inputs

Resolved by the entry prompt before invoking the skill:

- `month` — canonical `YYYY-MM` (single-month mode), OR
- `start` + `end` — canonical `YYYY-MM` range, both inclusive (range mode).
- `mode` — `single` | `refresh` | `range`.
- `repo` — repo name as it appears in the consumer's `workflows/registry/index.md`.
- Registry metadata for that repo: `repo-guid`, ADO `project` / `area-path`, `bot-identity-ids`, local checkout path.
- `toolLaunchMonth` — consumer-owned start-of-data marker (canonical `YYYY-MM`). Used as the trend-report clamp and FN-attribution cutoff. Earlier months CANNOT be tool false negatives. Single-month runs allowed for any historical month; range runs MUST clamp `start >= toolLaunchMonth`.

## Quick Reference

| Item | Value |
| ---- | ----- |
| Skill version | `v1.0` (skill conversion of review-stats tool v1.x) |
| Tool comment signature | regex `pr-review v\d+\.\d+` in PR thread body |
| Output dir (single month) | `metrics/review-stats/<YYYY-MM>/` |
| Output dir (range) | `metrics/review-stats/range-<start>_<end>/` |
| Time anchor | PR `closedDate` falls in month (FN = introducing PR's month) |
| Helper scripts | `tools/review-stats/` — see that dir's README for the Scripts table. |
| Subagents | `.github/agents/review-stats-effective-checker.md` (Step 5b) · `.github/agents/review-stats-fn-detector.md` (Step 6). Both read cached files only — MUST NOT call ADO. |

## Execution Conventions

| Topic | Rule |
| ----- | ---- |
| Todo list | Before any computation, create a `manage_todo_list` mirroring the workflow steps; mark in-progress → completed as you go. |
| Cache | Default mode re-uses `metrics/review-stats/<YYYY-MM>/raw/pr-<id>.json` + `threads-<id>.json`; only fetch missing PRs. `refresh` deletes `raw/` and re-fetches all. |
| Subagent isolation | `review-stats-effective-checker` and `review-stats-fn-detector` read cached files only — they MUST NOT call ADO. Main agent is the sole fetcher. |
| File locations | Final outputs in `metrics/review-stats/<YYYY-MM>/`; cached fetches in `raw/`; per-run scratch in `scratch/`; reusable scripts in `tools/review-stats/`. **NEVER write to `tmp/`.** |
| Cross-month writes | False negatives are attributed to the **introducing** PR's closed month — update `metrics/review-stats/<introducing-month>/data.json` `attributed_false_negatives[]` (mkdir if absent). Current month's report lists them under `discovered_false_negatives_this_month`. |
| Tool launch month | Range reports clamp `start >= toolLaunchMonth` and refuse earlier inclusion (warn + clamp). Single-month runs are allowed for any historical month for ad-hoc inspection; pre-launch months are flagged in the report. Fix PRs whose introducing PR predates `toolLaunchMonth` are `pre-launch` and CANNOT be tool false negatives. |

## Rules

- Skill body and all files in this directory are HOST-AGNOSTIC. The ADO MCP allowlist lives in the consuming prompt; helper scripts under `tools/review-stats/` are already parameterized (`-AdoOrg`, `-AdoProject`, `-RepositoryId`, `-AdoResourceGuid`).
- Subagents under `{toolkit-root}/agents/review-stats-*.md` read this skill's files via `{toolkit-root}/skills/review-stats/...` paths (where `{toolkit-root}` is the path the entry prompt resolved). When moving files inside this skill, update the subagent path refs.
- Do NOT read [reference.md](./reference.md) upfront. Step 8 of the single-month workflow reads it for the JSON schema and Markdown report template.
- Do NOT read [charts.md](./charts.md) upfront. Step 8.5 (single) and Step 5.5 (range) read it for chart specs.
- Do NOT read [effectiveness.md](./effectiveness.md) upfront. Step 5 of the single-month workflow reads it for the fast-path rules + subagent contract.

## Workflows

- **Single-month**: [workflow.md](./workflow.md) — fetch + parse + Step-5 effectiveness + Step-6 FN detection + Step-8 outputs + Step-8.5 charts.
- **Range trend**: [range-workflow.md](./range-workflow.md) — reads cached `data.json` only, no ADO fetch.

## References

- [workflow.md](./workflow.md) — single-month orchestration (9 steps).
- [range-workflow.md](./range-workflow.md) — range aggregation (cached only).
- [effectiveness.md](./effectiveness.md) — Step 5 sub-workflow (fast-paths + subagent).
- [reference.md](./reference.md) — JSON schema + Markdown report template.
- [charts.md](./charts.md) — chart catalog (Mermaid + HTML).
