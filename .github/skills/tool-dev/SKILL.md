---
name: tool-dev
description: Create, update, or review tools (prompts, agents, skills, CLI scripts, MCP servers) following workspace standards. Owns the create / update / review flow, the file-size budgets, the extensibility gate, the context-engineering rules, the Confirm Design Gate for bug-fix updates, and the changelog growth-control rule. Use when asked to add a new tool, modify an existing tool's prompt / agent / skill / doc, or audit a tool's design.
user-invocable: false
---

# Tool development (meta)

Workspace standards for creating, updating, and reviewing tools. Host-agnostic body; the consuming prompt owns the MCP `tools:` allowlist (Dev/debug tools used when developing or testing other tools).

## When to use this skill

- The caller says "create tool <name>", "update tool <name>", "review tool <name>", or runs `/tool-dev create|update|review <name>`.
- The caller's entry prompt has set up the MCP tool allowlist (this skill itself declares no `tools`; the consuming prompt owns the allowlist).
- The consumer has the standard workspace layout: `.github/prompts/`, `.github/agents/`, `.github/skills/`, `docs/tools/`, and `docs/backlog.md`.

When NOT to use it:

- The caller wants generic coding help — that's the default agent, not this skill.
- The caller wants to change a tool's behavior in response to a real failure / regression but has not yet attached the failing PR / WI / comment — ask for it first; the bug-fix path of `update` requires evidence.

## Inputs

- `toolkit-root` — workspace-relative path the entry prompt resolved (`.copilot-toolkit/.github` when consumed via submodule, `.github` when self-hosted in this repo). The skill threads this value to every subagent so each one can locate its `{toolkit-root}/skills/tool-dev/...` references at runtime.
- `action` — `create` | `update` | `review` (resolved by the entry prompt from `${input:action}`).
- `name` — tool name (resolved from `${input:name}`).
- `user request text` — the freeform sentence the user attached after `/tool-dev <action> <name>` (used by the Confirm Design Gate to classify update intent).

## **WARNING**: Todo-Driven Execution

**BEFORE any file write, tool call, or terminal command, you MUST create a todo list using `manage_todo_list` that mirrors the chosen action's step list verbatim (For "create": 9 steps; For "update": 8 steps; For "review": 7 steps).** Mark in-progress → completed one at a time. The task is done **only when every todo is completed** — do not stop after the last code edit. No exceptions.

## Rules

- **No wildcard tools** — always specify exact tool names, never use `*`
- **Recipe glue = Node script, not inline shell** — deterministic multi-step glue in a skill/workflow recipe (git orchestration, JSON shaping, file scaffolding) goes in a committed `scripts/<name>.mjs` run as `node .copilot-toolkit/scripts/<name>.mjs …`, NOT an inline `pwsh`/`bash` block in the markdown. Inline shell in recipes breaks on cross-platform quoting/escaping and can't be tested; Node is the guaranteed runtime (preflight). Single host commands (`git --no-pager …`) stay inline; anything with a loop / branch / multi-command sequence becomes a script. LLM judgment stays in markdown — only deterministic glue moves to the script. Enforced by `node .copilot-toolkit/scripts/lint-recipes.mjs` (fails on multi-step inline shell in `.github/skills` / `.github/prompts` recipes); opt out an intentional inline block with `<!-- lint-recipes: allow <reason> -->` on the line above the fence.
- **Helper scripts default to Node** — a new committed `scripts/` helper is a `.mjs` run via `node`, not a `.ps1`/`.sh`, UNLESS it must run before Node is guaranteed (install / bootstrap precedes preflight — e.g. `install/sync.ps1` + `sync.sh`) or needs a shell-native capability with no reasonable Node equivalent. Prefer Node; when you pick PowerShell/bash, state the reason in the script header.
- **Extend, don't fork** — when a `scripts/` helper in the repo you are working on needs new behavior, add a switch or parameter to the existing one. Never land `<name>-v2`, `<name>-new`, `<name>-<YYYY-MM>`, or `backfill-<id>` as a permanent helper; one-shot work goes to a scratch dir, never into `scripts/`.
- **Prompt = self-contained, Doc = design knowledge** — prompts contain all runtime instructions; `docs/tools/<name>.md` stores design rationale, changelog, test cases (read only by this skill). If a prompt needs reference data, inline it or put in a skill / workflow file. Never load doc files at runtime from the tool's own prompt.
- **Context budget = main-agent steady-state, not file LOC.** A 200-line reference loaded only by one subagent ≪ a 30-line block inlined in main-agent workflow that re-enters context every turn. Optimize for "main-agent free ctx in mid/late execution", not for total LOC.
- **File size budgets** (split by load site):
  - **Main-agent-loaded** (prompt, workflow main file, on-every-run): prompt ~80, workflow ~120, doc ~150. **Strict** — exceeded = split.
  - **Subagent-loaded / on-demand** (reference, rules, anti-patterns, decision tables, schemas): no hard limit — fresh window per dispatch. Budget by readability instead.
- **Anti-patterns / rules / catalogs live in separate files** — NEVER inline anti-pattern catalogs, smell lists, or rule sets into a main-agent-loaded workflow or prompt. They go in `<skill>/anti-patterns/*.md` or `rules.md` and are loaded by subagents (or by the main agent on explicit step-scoped trigger).
- **Least-privilege tools** — each tool's prompt declares only needed tools. Exception: the tool-dev prompt itself carries extra MCP tools (marked `# Dev/debug`) for developing/testing other tools.
- **External-endpoint integration (runtime ≠ metadata)** — adding or changing an external endpoint the agent must reach (new Kusto cluster / database, new ADO org, new ICM tenant, new MCP service) requires updates in **all four** layers in the same commit:
  1. `.vscode/mcp.json` — server entry (separate entry per fixed endpoint is preferred over a re-prompted `${input:...}`)
  2. `.github/copilot-instructions.md` — `## MCP Server Mapping` table
  3. The consuming prompt's `tools:` frontmatter — exact tool names (e.g. `<kusto-server-name>/execute_query`)
  4. The registry / reference doc — point to the new server by name
  Registry metadata alone is **not** enough — without the MCP server entry the agent cannot reach the endpoint at runtime. Self-check: "If I asked a fresh agent to act on this new metadata, would it have a working tool call?" — if no, layers 1-3 are missing.
- **Extensibility gate (two triggers)**:
  1. Before creating a new knowledge file: will it grow? Open-ended + subset access -> directory + index from start.
  2. **IF a tool already has 3+ files under a workflow / skill dir (flat) AND you are adding another → must restructure into a subdir first.** Flat accumulation is the #1 source of tool-dir drift.
- **Restructure = verify** — inventory -> create new -> slim old -> verify references -> dedup -> budget check
- **Reference loading** — inline <=10 lines; step-scoped (not upfront); `IF <condition> -> read <file>`; no circular refs; max depth = 5
- **Changelog growth control** — `docs/tools/<name>.md` `## Changelog` keeps **only the 3 most recent entries** + a closing `Full history: \`git log -p -- docs/tools/<name>.md\`` pointer. On every `update`: prepend new entry, then DELETE the now-4th entry (and any older). Older history lives in git, not in the file. Never append without trimming.

## Subagent Delegation

For "create": delegate **research** (scan existing tools for overlap, check naming conflicts) to a subagent before creating files.

For "review": delegate these in parallel as subagents:
- Doc completeness check (required sections, changelog format)
- Test case coverage check (targets vs test cases)
- Prompt validation (syntax, tools list correctness)
- Context & workflow design (reference scoping, component budgets, subagent isolation, loading efficiency)
Then synthesize subagent findings into a single review report.

## Required Sections (inline reference)

```
# Tool Name
Status: **status** | Since: YYYY-MM-DD
## Purpose
## Dependencies (if any)
## Usage
## Implementation
## Key Design
## Targets & Test Cases
## Changelog          # Latest + up to 2 Previous + `Full history: git log -p -- docs/tools/<name>.md`
## TODO
```

Status values: `stable`, `active`, `planned`, `blocked`.

## For "create":

1. Use a subagent to research: scan workspace for naming/scope conflicts with existing tools
2. **System analysis before tooling** — IF the tool interacts with an existing codebase or system:
   - Map the architecture: data flow, auth chain, DI boundaries, interface seams
   - Identify the minimal intervention point (e.g., a single interface to swap) before designing a full reimplementation
   - Verify outputs: if the target system can swallow exceptions (NoThrow, catch-all), plan explicit verification
   - Never plan to modify product/submodule code when the user asked for an independent tool
3. **Extensibility gate**: IF creating knowledge file (catalogs, rules, patterns) → read [context-engineering.md](./context-engineering.md) (~121 lines), assess growth trajectory, pick structure
4. **Context design brief** — list workflow overview, each component (prompt, doc, references, subagents) with estimated size and load timing, total context budget, design rationale and purpose. IF references/subagents involved → read [context-engineering.md](./context-engineering.md) + [subagent-design.md](./subagent-design.md) as design basis.
5. Create `docs/tools/<name>.md` with all required sections above (respect ~150 line budget)
6. Create implementation — use `.copilot-toolkit/templates/_template.prompt.md` or `.copilot-toolkit/.github/agents/_template.md` as starting point (paths assume submodule / sync mount; if you self-host the toolkit as the workspace root, drop the `.copilot-toolkit/` prefix). Respect file size budgets
7. IF any existing files overlap with the new tool → run Restructure Verification Checklist
8. Update `docs/index.md` dashboard
9. Add test verification task to `docs/backlog.md`

## For "update":

1. Read existing tool doc
2. **Context impact** — describe what changes, purpose, impact on context pressure (which components change size, does loading pattern change). IF references/workflows/subagents affected → read [context-engineering.md](./context-engineering.md).
3. **Confirm Design Gate** — read [update-design-gate.md](./update-design-gate.md) and follow it exactly. IF Bug-fix: HARD STOP, no edits, end turn. IF Polish: print the polish line and proceed to step 4.
4. Make changes — check file size budgets after edit; split if exceeded
5. IF restructuring (splitting files, moving content) → run Restructure Verification Checklist
6. Update changelog section — prepend new entry, **trim to 3 total** (delete the now-4th and older), ensure `Full history: git log -p -- docs/tools/<name>.md` pointer is present
7. Update `docs/index.md` status if needed
8. **MANDATORY PR check-in** — create branch, commit (code + changelog + dashboard in **one** commit), push, create PR via the consumer's configured PR-creation mechanism. Take repo / branch / project / org from the consumer's registry — do NOT hard-code them. IF PR creation fails (auth / tenant mismatch): print a manual URL built from the registry values and stop. Reaching the end of step 8 without an open PR = task NOT done.

## For "review":

1. Read tool doc
2. Delegate in parallel via subagents:
   - Doc completeness check (required sections, changelog format)
   - Test case coverage check (targets vs test cases)
   - Prompt validation (syntax, tools list correctness)
   - Context & workflow design (reference scoping, component budgets, loading efficiency)
3. Synthesize subagent findings into a findings list. **Verify factual claims** — main agent must spot-check subagent line counts and assertions (e.g., run terminal line count) before accepting findings.
4. **Root-cause & fix trade-off** — delegate to a subagent: for each finding, return (a) root cause: rule missing / ambiguous / not applied, (b) 2-3 fix options with trade-offs, (c) recommendation. Main agent reviews and picks fixes (ask user if ambiguous).
   - **Before removing "duplication"**: check changelog for prior review fixes that intentionally added this content. If found, it is intentional redundancy — do NOT remove without user confirmation.
5. **Dedup against changelog** — check if any finding was reported in a previous review round but not actually fixed. Flag as recurring.
6. Suggest missing test cases
7. **Run tests** (manual only) — test execution requires human interaction; suggest which tests to run but do not treat as required verification

After review, user can run `/tool-dev update` to implement agreed fixes.

## References

- [context-engineering.md](./context-engineering.md) — file size budgets, extensibility assessment, chunking by access pattern, restructure verification, reference loading rules.
- [subagent-design.md](./subagent-design.md) — when to use subagents, agent file structure, design principles, context budgets, reference isolation, orchestration patterns.
- [update-design-gate.md](./update-design-gate.md) — Confirm Design Gate for the `update` flow (Bug-fix vs Polish classification).
