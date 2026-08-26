---
description: "Onboard a new repo as submodule with registry entry"
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

Onboard-repo entry point. The workflow body lives in skill [onboard-repo](../skills/onboard-repo/SKILL.md) — this prompt is a thin shim.

## Commands

| Command | Action |
| ------- | ------ |
| `/onboard-repo` | Add a new repository as a git submodule with registry entry and tool integration. Prompts for repo URL, tech stack, and ownership input (provider-dependent). |

## /onboard-repo

When the user runs `/onboard-repo`:

1. Compute `$toolkitRoot = if (Test-Path '.copilot-toolkit/.github') { '.copilot-toolkit/.github' } else { '.github' }` — passed to the skill so subagents can locate `{toolkit-root}/skills/onboard-repo/...` files at runtime.
2. **Invoke skill `onboard-repo`** with `toolkit-root: $toolkitRoot` and the user-supplied inputs (collected interactively by the skill: repo URL, tech stack, ownership input).
3. Follow the skill's [SKILL.md](../skills/onboard-repo/SKILL.md) — it owns the provider dispatch, submodule add, registry entry authoring, downstream-prompt tool wiring, commit, and report.
