---
description: Create, update, or review tools following workspace standards
tools:
  - vscode
  - execute
  - read
  - edit
  - search
  - web
  - agent
  - todo
  # MCP server names below (ado-2, ado-3, ado-1, incident-1) are neutral
  # placeholders. Configure your `.vscode/mcp.json` to match — see INSTALL.md
  # "MCP server naming convention". If you prefer real names, copy this prompt
  # locally and adjust the entries.
  #
  # Dev/debug — used when developing or testing other tools, not for tool-dev's
  # own workflow. Each consumer wires the servers it actually needs.
  - ado-2/wit_get_work_item
  - ado-2/wit_get_work_item_type
  - ado-2/wit_list_work_item_comments
  - ado-1/repo_get_pull_request_by_id
  - incident-1/get_contact_by_alias
  - incident-1/get_team_by_id
  - incident-1/get_teams_by_name
  # ado-3: ADO org that hosts the consumer's own toolkit / scratch repo
  # (branches, PRs for tool-dev's `update` flow PR check-in)
  - ado-3/repo_get_repo_by_name_or_id
  - ado-3/repo_create_branch
  - ado-3/repo_create_pull_request
  - ado-3/repo_get_pull_request_by_id
  - ado-3/repo_list_pull_requests_by_repo_or_project
---

Tool-dev entry point. Owns the MCP `tools:` allowlist (above — Dev/debug tools used when developing or testing other tools). The workflow body lives in skill [tool-dev](../skills/tool-dev/SKILL.md) — this prompt is a thin shim that resolves input and delegates.

Action: ${input:action:create/update/review}
Tool name: ${input:name:tool name}

## Input Resolution (Step 0)

When the user runs `/tool-dev <action> <name> [user request text]`:

1. Compute `$toolkitRoot = if (Test-Path '.copilot-toolkit/.github') { '.copilot-toolkit/.github' } else { '.github' }` — passed to the skill so subagents can locate `{toolkit-root}/skills/tool-dev/...` files at runtime.
2. Validate `action` ∈ `{create, update, review}`; reject otherwise.
3. Capture the freeform `user request text` (the sentence after `/tool-dev <action> <name>`, plus any quoted PR / WI / comment the user attached) — the Confirm Design Gate uses this to classify update intent, NOT the `${input:action}` slot.
4. **Invoke skill `tool-dev`** with: `toolkit-root: $toolkitRoot`, `action`, `name`, `user request text`. Follow the skill's [SKILL.md](../skills/tool-dev/SKILL.md) — it owns the todo plan, the create / update / review step lists, the file-size budgets, the extensibility gate, the changelog growth-control rule, and the Confirm Design Gate.

For PR check-in (Step 8 of the `update` flow), use the ADO MCP tools above with repo / branch / project / org sourced from the consumer's local registry entry for the toolkit / scratch repo (e.g. `.github/prompts/workflows/registry/<your-toolkit-repo>.md`).
