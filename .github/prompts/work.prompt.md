---
description: "Work: tracked-item-driven implementation (bug fix / feature)"
tools:
  - read
  - edit
  - execute
  - search
  - agent
  - todo
  # MCP server names below (ado-1, ado-2, kusto-1) are neutral placeholders.
  # Configure your `.vscode/mcp.json` to match — see INSTALL.md "MCP server
  # naming convention". If you prefer real names, copy this prompt locally and
  # adjust the entries.
  #
  # ado-2: ADO org that hosts work items (may differ from repo org)
  - ado-2/wit_get_work_item
  - ado-2/wit_list_work_item_comments
  - ado-2/wit_add_work_item_comment
  - ado-2/wit_list_work_item_revisions
  - ado-2/wit_create_work_item
  - ado-2/wit_update_work_item
  - ado-2/wit_add_child_work_items
  - ado-2/wit_link_work_item_to_pull_request
  - ado-2/search_code
  - ado-2/repo_create_pull_request
  - ado-2/repo_get_pull_request_by_id
  # ado-1: ADO org that hosts the code repo (may equal ado-2)
  - ado-1/repo_create_pull_request
  - ado-1/repo_get_pull_request_by_id
  - ado-1/repo_list_pull_request_threads
  - ado-1/repo_list_pull_request_thread_comments
  - ado-1/repo_reply_to_comment
  # kusto-1: Kusto MCP for telemetry queries during RCA (optional)
  - kusto-1/execute_query
  - kusto-1/get_entities_schema
  - kusto-1/get_function_schema
  - kusto-1/get_table_schema
  - kusto-1/list_databases
  - kusto-1/list_tables
  - kusto-1/sample_table_data
---

Entry point for tracked-item-driven work (feature or bug fix). Owns the MCP `tools:` allowlist. The workflow body lives in skill [work](../skills/work/SKILL.md) — this prompt is a thin shim that resolves input and delegates.

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
- `Explore` — generic read-only codebase exploration.
