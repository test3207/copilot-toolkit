---
name: work
description: Daily dev workflow for Feature & Bug fix with tracked-item integration (ADO Work Item / GitHub Issue, registry-selected). Drives input → analyze/design → [confirm] → implement (via spec + work-implementer subagent) → test → PR. Use when asked to start work on an issue, fix a bug, build a feature, or otherwise carry a tracked item end-to-end. Host-agnostic body; tracker-specific recipes (getItem / createItem / linkPR / commit-message suffix / PR-description link) come from a provider file under providers/.
user-invocable: false
---

# Work

Daily dev: Feature & Bug fix with tracked-item integration. Host-agnostic body; tracker-host-specific recipes (URL format, getItem / createItem / addChildren / linkPR / commit-message suffix / PR-description link) come from a provider file under [providers/](./providers/).

## When to use this skill

- The caller says "start work on <id>", "fix bug <id>", "build feature <id>", or runs `/work start <id|url>`.
- The caller's entry prompt has set up the MCP tool allowlist (this skill itself declares no `tools`; the consuming prompt owns the allowlist).
- The consumer has a registry entry for the repo containing an `issue-tracker` field (`ado` / `github` / future hosts). If missing, default to `ado` for back-compat.

When NOT to use it:

- The repo is not present in the consumer's registry — ask the caller to onboard it via `/onboard-repo` first.
- The caller only wants to read / explore an item without starting work — that lives in the consumer's entry prompt or a dedicated explorer; this skill assumes intent to drive a tracked item to PR.

## Inputs

- `toolkit-root` — workspace-relative path the entry prompt resolved (`.copilot-toolkit/.github` when consumed via submodule, `.github` when self-hosted in this repo). The skill threads this value to every subagent so each one can locate its `{toolkit-root}/skills/work/...` references at runtime.
- `itemId` — numeric tracker id (already resolved by the entry prompt via `.copilot-toolkit/scripts/parse-input.mjs`), OR `null` when the caller invoked `/work start` with no id.
- `repo` — repo name as it appears in the consumer's `workflows/registry/index.md` (resolved from the item area-path / labels, or from cwd when `itemId` is null).
- Registry metadata for that repo (loaded by the entry prompt): `path`, `build`, `frameworks`, `coding-standards`, `feature-gating`, `kusto`, `issue-tracker` (default `ado`), `incident-source` (optional).

## Quick Reference

| Item | Value |
| ---- | ----- |
| Skill version | `v1.1` (skill conversion of work tool v2.x; closure validators shipped in v1.1) |
| Working dir | `metrics/work/{itemId}/spec.md` — frozen implementation spec (main agent writes, `work-implementer` reads). |
| Providers | [providers/ado.md](./providers/ado.md), [providers/github.md](./providers/github.md). Add a new file under `providers/` for new hosts; no workflow edits required. |
| Subagents | `.github/agents/work-architect-explorer.md` (Analyze · Medium/Full) · `.github/agents/work-impact-tracer.md` (Analyze Full · RCA Deep) · `.github/agents/work-rca-tracer.md` (RCA Standard/Deep) · `.github/agents/work-implementer.md` (post-confirm Implement) · `.github/agents/work-closure-direction-validator.md` + `.github/agents/work-closure-detail-validator.md` (post-implement closure, parallel). |

## Input Resolution (Step 0)

Performed by the entry prompt, then handed to this skill:

1. Parse the input ID / URL via `node .copilot-toolkit/scripts/parse-input.mjs "<input>"`.
2. Read `workflows/registry/index.md` to match the repo. IF the input is a tracked-item id and no direct repo match: fetch item details via the resolved provider, match `area-path` (ADO) or `github-label` (GitHub) against registry entries.
3. Read `workflows/registry/<matched-repo>.md` for full metadata.
4. **Resolve issue-tracker provider** — read the entry's `issue-tracker` field (default `ado`). Load [providers/{issue-tracker}.md](./providers/) once per session — every later step's `getItem` / `createItem` / `addComment` / `linkPR` / commit-message-suffix / PR-description-link call resolves via this provider, not the workflow body.
5. **Resolve incident-source (bug only, optional)** — IF the entry declares `incident-source: <path>`, the main agent loads that file at the start of `bugfix.md` Step 1. Path is relative to `.github/prompts/`. Consumer-owned; upstream never authors one.
6. IF the entry has `monorepo = true`: resolve service (match item area-path / labels against the Services table; fall back to `default-service`). Scope code search to `<service-path>/` + `src/Shared/`; scope build to `<service-path>/`.

## On Start

1. Call provider `getItem(itemId)` — returns `{ title, body, type, parentId, attachments[], comments[] }`. ADO provider expands relations under the hood; GitHub provider derives the parent from task-list checkboxes. See [providers/{active}.md](./providers/).
2. Review `attachments[]` for specs / screenshots / repro files.
3. Determine type from the provider's mapping: `feature` or `bug`.
4. Read the matching workflow file + shared steps:
   - Feature: [feature.md](./feature.md) + [shared.md](./shared.md)
   - Bug: [bugfix.md](./bugfix.md) + [shared.md](./shared.md)
5. **MUST: create todo list FIRST** via `manage_todo_list` — plan all phases before any work.
6. Execute todos one at a time (in-progress → complete).

## Phase Todos (create at start, one in-progress at a time, never skip)

Load the matching workflow file for the exact phase list; mirror it into the todo list.

| Workflow | Phases |
| -------- | ------ |
| Feature  | Understand → Analyze & Design → [Review Confirm] → (Feature Gating, if repo has it) → Implement → Test → PR |
| Bugfix   | Gather Info → Root Cause Analysis → [Confirm RCA] → Fix Design → [Confirm Fix] → (Feature Gating, if repo has it) → Implement → Test → PR |

## **MANDATORY**: Subagent dispatch before any write op

**Self-check before EVERY file-write call** (any invocation of the `edit` tool group — `edit_file`, `replace_string_in_file`, `multi_replace_string_in_file`, `create_file`):

| Phase | Depth | Required action |
| ----- | ----- | --------------- |
| Pre-confirm (Analyze / RCA / Fix-Design) | Light | inline OK |
| Pre-confirm | Medium / Standard | dispatch `work-architect-explorer` (feature) or `work-rca-tracer` (bug) |
| Pre-confirm | Full / Deep | dispatch above **+** `work-impact-tracer` in parallel |
| Post-confirm (Implement) | Light | inline OK (one-line typo / single-value config) |
| Post-confirm | Medium / Full / Standard / Deep | write spec to `metrics/work/<item-id>/spec.md`, dispatch `work-implementer`. Main agent does NOT edit code. |

The pre-confirm explorers stop the main agent from patching the symptom layer. The post-confirm implementer stops the main agent's context from filling with file reads / multi-edit hunks / build output once design is frozen. PR creation, commit message, and tracked-item updates stay with the main agent.

**Post-implement closure validation is mandatory too, but it is NOT in the table
above** — its trigger is `work-implementer` returning `status: complete`, not a
file-write call. Once the implementer reports done, dispatch
`work-closure-direction-validator` and `work-closure-detail-validator` in a single
parallel block before acknowledging to the user. Contract, inputs, and the
auto-bounce / surface-to-user gate live in [shared.md](./shared.md) (Implement §3).

### Classification is sticky

Once a phase's depth is recorded (feature.md §2.1 / bugfix.md §2.1), it MUST NOT
be silently downgraded to skip the corresponding subagent dispatch:

- Medium → Light, Standard → Light, Full → Medium, Deep → Standard: each requires
  an **explicit user-visible note** of the form "downgrading <phase> from <X> to
  <Y> because <reason>" plus **explicit user agreement** before proceeding.
- "It turns out to be simpler than I first thought" is the most common rationalisation
  for an unsafe downgrade. Under context pressure, what looks simple to the main
  agent is usually a missed seam the subagent would have found.
- Upgrading (Light → Medium, Medium → Full, etc.) is always free and does not
  require permission — escalate without asking.

Self-check: if your next planned action is "inline edit because actually this is
Light", and the recorded classification is not Light, **STOP** and either dispatch
the subagent the recorded depth requires, or surface the downgrade request to the
user with reason.

## Rules

- Skill body and all files in this directory are HOST-AGNOSTIC. Any tracker-specific recipe (URL format, fetch / create / link, commit-message suffix) belongs in `providers/<name>.md`, never in `feature.md` / `bugfix.md` / `shared.md` / `anti-patterns/`.
- Subagents under `{toolkit-root}/agents/work-*.md` read this skill's files via `{toolkit-root}/skills/work/...` paths (where `{toolkit-root}` is the path the entry prompt resolved). When moving files inside this skill, update the subagent path refs.
- The consumer's entry prompt owns the `tools:` allowlist (MCP tool whitelist). This skill itself declares no `tools` — by design.
- The workflow body never names a specific incident system (ICM / OpsGenie / etc.). Consumers wire one in via the optional `incident-source` registry field; the bugfix workflow loads that consumer-owned file when present.

## References

- [feature.md](./feature.md) — Feature workflow: Understand → Analyze & Design → [Review Confirm].
- [bugfix.md](./bugfix.md) — Bug workflow: Gather → RCA → [Confirm RCA] → Fix Design → [Confirm Fix].
- [shared.md](./shared.md) — Feature Gating Decision → spec template → Implement dispatch → Test → PR.
- [providers/_index.md](./providers/_index.md) — issue-tracker provider contract (8 ops + registry shape + incident-source plugin slot).
- [anti-patterns/design.md](./anti-patterns/design.md) — design anti-patterns (DAP-01..08); subagent-loaded only, main agent never reads.
