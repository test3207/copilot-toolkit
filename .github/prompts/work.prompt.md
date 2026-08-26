---
description: "Work: tracked-item-driven implementation (bug fix / feature)"
tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - browser
  - agent
  - todo
---

Entry point for tracked-item-driven work (feature or bug fix). The workflow body lives in skill [work](../skills/work/SKILL.md) — this prompt is a thin shim that resolves input and delegates.

## Usage

```
/work <input>
```

Where `<input>` may be:
- A natural-language repo selector (e.g. `repo-name fix the foo bug`).
- A tracked-item URL or ID (auto-resolves the repo via registry).
- An empty invocation (prompt walks the user through repo / item selection).

## Flow

1. **Resolve input** (Step 0 of the work skill):
   - Compute `$toolkitRoot = if (Test-Path '.copilot-toolkit/.github') { '.copilot-toolkit/.github' } else { '.github' }`.
   - Run `node .copilot-toolkit/scripts/parse-input.mjs "<input>"` (path assumes submodule / sync mount; if you self-host the toolkit by checking it out as the workspace root, drop the `.copilot-toolkit/` prefix).
   - Read `.github/prompts/workflows/registry/index.md` to match the repo.
   - Read `.github/prompts/workflows/registry/<matched-repo>.md` for full metadata.
2. **Invoke skill `work`** with: `toolkit-root: $toolkitRoot`, the resolved repo, registry metadata (`path`, `pr-platform`, `ado-repo-server`, `ado-wi-server`, build commands, anti-pattern allowlist), and the raw user input.
3. Follow [SKILL.md](../skills/work/SKILL.md) — it owns the workflow: input → analyze/design → [confirm] → implement (via spec + `work-implementer` subagent) → test → PR.

## Subagents

- `work-architect-explorer` — map architecture and propose minimal intervention point.
- `work-impact-tracer` — trace call chain / blast radius of proposed touch points.
- `work-rca-tracer` — trace bug symptom to root cause (for bug-fix flow).
- `work-implementer` — apply a confirmed implementation spec, build, run UTs, return diff summary.
- `work-closure-direction-validator` — after implement, audit the direction of the change.
- `work-closure-detail-validator` — after implement, audit for missed / orphaned references.
- `Explore` — generic read-only codebase exploration.
