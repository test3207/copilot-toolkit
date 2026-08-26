---
description: Create, update, or review tools following workspace standards
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

Tool-dev entry point. The workflow body lives in skill [tool-dev](../skills/tool-dev/SKILL.md) — this prompt is a thin shim that resolves input and delegates.

Action: ${input:action:create/update/review}
Tool name: ${input:name:tool name}

## Input Resolution (Step 0)

When the user runs `/tool-dev <action> <name> [user request text]`:

1. Compute `$toolkitRoot = if (Test-Path '.copilot-toolkit/.github') { '.copilot-toolkit/.github' } else { '.github' }` — passed to the skill so subagents can locate `{toolkit-root}/skills/tool-dev/...` files at runtime.
2. Validate `action` ∈ `{create, update, review}`; reject otherwise.
3. Capture the freeform `user request text` (the sentence after `/tool-dev <action> <name>`, plus any quoted PR / WI / comment the user attached) — the Confirm Design Gate uses this to classify update intent, NOT the `${input:action}` slot.
4. **Invoke skill `tool-dev`** with: `toolkit-root: $toolkitRoot`, `action`, `name`, `user request text`. Follow the skill's [SKILL.md](../skills/tool-dev/SKILL.md) — it owns the todo plan, the create / update / review step lists, the file-size budgets, the extensibility gate, and the Confirm Design Gate.

For PR check-in (the last step of the `update` flow), use the consumer's configured PR-creation mechanism with repo / branch / project / org sourced from the consumer's local registry entry for the toolkit / scratch repo (e.g. `.github/prompts/workflows/registry/<your-toolkit-repo>.md`).
