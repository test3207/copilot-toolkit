---
# Prompt File Template
# Docs: https://code.visualstudio.com/docs/copilot/customization/prompt-files
#
# Header fields (all optional):
#   description  - Short description shown in picker
#   name         - Custom name (default: filename)
#   tools        - List of tools to enable
#   agent        - Agent to use: ask, edit, agent
#   model        - Model to use (default: current selection)
#
# Tools - array syntax (preferred):
#
#   Built-in tool groups:
#     vscode, execute, read, edit, search, web, browser, agent, todo
#     (browser = experimental, gated by `workbench.browser.enableChatTools`; org-managed, may be unavailable)
#
#   Specific built-in tools:
#     execute/runInTerminal, read/terminalLastCommand, fetch, codebase, etc.
#
#   MCP server tools:
#     <server>/*           (all tools from server)
#     <server>/<tool>      (specific tool)
#
#   Examples:
#     All built-in:        tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'browser', 'agent', 'todo']
#     Subset:              tools: ['read', 'edit', 'execute']
#     With MCP:            tools: ['read', 'edit', 'ado-repo/*']
#     Mixed:               tools: ['vscode', 'execute', '<server-name>/wiki_get_page']
#
# Available MCP Servers & Tools (from .vscode/mcp.json):
#
#   ADO servers (one or more, named in .vscode/mcp.json — each scoped to one org):
#     <ado-server-name>/*  - per-server scope: org + auth (configure your own in mcp.json)
#
#   ADO Tool Usage Notes:
#     - Some tools (e.g., repo_get_pull_request_by_id) require repository GUID, not name
#     - Use repo_get_repo_by_name_or_id to get GUID first, or cache it in prompt
#     - Always provide `project` parameter when available (even if optional)
#
#     Tools:
#       advsec_get_alert_details
#       advsec_get_alerts
#       core_get_identity_ids
#       core_list_project_teams
#       core_list_projects
#       pipelines_create_pipeline
#       pipelines_get_build_changes
#       pipelines_get_build_definition_revisions
#       pipelines_get_build_definitions
#       pipelines_get_build_log
#       pipelines_get_build_log_by_id
#       pipelines_get_build_status
#       pipelines_get_builds
#       pipelines_get_run
#       pipelines_list_runs
#       pipelines_run_pipeline
#       pipelines_update_build_stage
#       repo_create_branch
#       repo_create_pull_request
#       repo_create_pull_request_thread
#       repo_get_branch_by_name
#       repo_get_pull_request_by_id
#       repo_get_repo_by_name_or_id
#       repo_list_branches_by_repo
#       repo_list_my_branches_by_repo
#       repo_list_pull_request_thread_comments
#       repo_list_pull_request_threads
#       repo_list_pull_requests_by_commits
#       repo_list_pull_requests_by_repo_or_project
#       repo_list_repos_by_project
#       repo_reply_to_comment
#       repo_search_commits
#       repo_update_pull_request
#       repo_update_pull_request_reviewers
#       repo_update_pull_request_thread
#       search_code
#       search_wiki
#       search_workitem
#       testplan_add_test_cases_to_suite
#       testplan_create_test_case
#       testplan_create_test_plan
#       testplan_create_test_suite
#       testplan_list_test_cases
#       testplan_list_test_plans
#       testplan_list_test_suites
#       testplan_show_test_results_from_build_id
#       testplan_update_test_case_steps
#       wiki_create_or_update_page
#       wiki_get_page
#       wiki_get_page_content
#       wiki_get_wiki
#       wiki_list_pages
#       wiki_list_wikis
#       wit_add_artifact_link
#       wit_add_child_work_items
#       wit_add_work_item_comment
#       wit_create_work_item
#       wit_get_query
#       wit_get_query_results_by_id
#       wit_get_work_item
#       wit_get_work_item_type
#       wit_get_work_items_batch_by_ids
#       wit_get_work_items_for_iteration
#       wit_link_work_item_to_pull_request
#       wit_list_backlog_work_items
#       wit_list_backlogs
#       wit_list_work_item_comments
#       wit_list_work_item_revisions
#       wit_my_work_items
#       wit_update_work_item
#       wit_update_work_items_batch
#       wit_work_item_unlink
#       wit_work_items_link
#       work_assign_iterations
#       work_create_iterations
#       work_get_iteration_capacities
#       work_get_team_capacity
#       work_list_iterations
#       work_list_team_iterations
#       work_update_team_capacity
#
#   icm/* (ICM incidents):
#     Tools:
#       get_ai_summary
#       get_contact_by_alias
#       get_contact_by_id
#       get_impacted_ace_customers
#       get_impacted_azure_priority0_customers
#       get_impacted_s500_customers
#       get_impacted_services_regions_clouds
#       get_impacted_subscription_count
#       get_incident_context
#       get_incident_customer_impact
#       get_incident_details_by_id
#       get_incident_location
#       get_mitigation_hints
#       get_on_call_schedule_by_team_id
#       get_outage_high_priority_events
#       get_services_by_names
#       get_similar_incidents
#       get_support_requests_crisit
#       get_team_by_id
#       get_teams_by_name
#       get_teams_by_public_id
#       is_specific_customer_impacted
#       search_incidents_by_owning_team_id
#
#   microsoft-docs/* (Microsoft documentation):
#     Tools:
#       microsoft_code_sample_search
#       microsoft_docs_fetch
#       microsoft_docs_search
#
#   azure-kusto-mcp/* (Kusto queries):
#     Tools:
#       execute_command
#       execute_query
#       get_entities_schema
#       get_function_schema
#       get_table_schema
#       ingest_inline_into_table
#       list_databases
#       list_tables
#       sample_function_data
#       sample_table_data
#
#   playwright/* (Browser automation):
#     Tools:
#       browser_click
#       browser_close
#       browser_console_messages
#       browser_drag
#       browser_evaluate
#       browser_file_upload
#       browser_fill_form
#       browser_handle_dialog
#       browser_hover
#       browser_install
#       browser_navigate
#       browser_navigate_back
#       browser_network_requests
#       browser_press_key
#       browser_resize
#       browser_run_code
#       browser_select_option
#       browser_snapshot
#       browser_tabs
#       browser_take_screenshot
#       browser_type
#       browser_wait_for
#
# Agents (subagents):
#   Docs: https://code.visualstudio.com/docs/copilot/agents/subagents
#   To use subagents, include 'agent' in tools list.
#   Template: .github/agents/_template.md
#   Design guide: docs/tools/tool-dev.md (Agents section)
#
#   Restrict which agents can be used as subagents:
#     agents: ['doc-checker', 'test-runner']   # specific agents only
#     agents: ['*']                             # all agents (default)
#     agents: []                                # no subagents
#
# Variables:
#   ${input:name:placeholder}   - User input prompt
#   ${selection}                - Current editor selection
#   ${file}                     - Current file path
#   ${workspaceFolder}          - Workspace root
#
# Architecture note:
#   Prompt files (.prompt.md) are loaded into context permanently on use.
#   Keep prompts SHORT — only decision rules, triggers, and workflow steps.
#   Put detailed knowledge (syntax, examples, patterns) in docs/tools/<name>.md
#   and let the agent read_file on demand. This avoids wasting context tokens.
#
description: Template prompt
tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'browser', 'agent', 'todo']
# Uncomment to add MCP servers:
# tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'browser', 'agent', 'todo', '<ado-server>/*', 'icm/*']
---

Your task: ${input:task:describe the task}.

## Steps

1. First step
2. Second step

## Output

Describe expected output format.
