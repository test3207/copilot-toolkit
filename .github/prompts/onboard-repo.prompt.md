---
description: "Onboard a new repo as submodule with registry entry"
tools:
  - read
  - edit
  - execute
  - search
  - todo
  # MCP server names below (ado-1, ado-2) are neutral placeholders. Configure
  # your `.vscode/mcp.json` to match — see INSTALL.md "MCP server naming
  # convention". GitHub-only / generic-git consumers can ignore the ADO entries
  # (they are silently dropped if the server is not configured).
  - ado-1/repo_get_repo_by_name_or_id
  - ado-2/repo_get_repo_by_name_or_id
  - ado-2/wit_get_work_item
---

Onboard-repo entry point. Owns the MCP `tools:` allowlist (above; ADO MCP entries supply the ADO provider's `getRepoMetadata` + WI-link `resolveOwnership` recipes). The workflow body lives in skill [onboard-repo](../skills/onboard-repo/SKILL.md) — this prompt is a thin shim.

The `tools:` block carries the union of all supported providers' MCP tools; consumers that only use GitHub or generic git can ignore the unused ADO entries (no install impact — VS Code silently drops unavailable tools).

## Commands

| Command | Action |
| ------- | ------ |
| `/onboard-repo` | Add a new repository as a git submodule with registry entry and tool integration. Prompts for repo URL, tech stack, ownership input (provider-dependent), tools to apply. |

## /onboard-repo

When the user runs `/onboard-repo`:

1. Compute `$toolkitRoot = if (Test-Path '.copilot-toolkit/.github') { '.copilot-toolkit/.github' } else { '.github' }` — passed to the skill so subagents can locate `{toolkit-root}/skills/onboard-repo/...` files at runtime.
2. **Invoke skill `onboard-repo`** with `toolkit-root: $toolkitRoot` and the user-supplied inputs (collected interactively by the skill: repo URL, tech stack, ownership input, tools to apply).
3. Follow the skill's [SKILL.md](../skills/onboard-repo/SKILL.md) — it owns the provider dispatch, submodule add, registry entry authoring, downstream-prompt tool wiring, commit, and report.
