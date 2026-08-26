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
#     Server and tool names come from your own `.vscode/mcp.json`. The toolkit
#     ships no MCP server and mandates none.
#
#   Examples:
#     All built-in:        tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'browser', 'agent', 'todo']
#     Subset:              tools: ['read', 'edit', 'execute']
#     With MCP:            tools: ['read', 'edit', '<server-name>/*']
#     Mixed:               tools: ['vscode', 'execute', '<server-name>/<tool-name>']
#
# Agents (subagents):
#   Docs: https://code.visualstudio.com/docs/copilot/agents/subagents
#   To use subagents, include 'agent' in tools list.
#   Template: .copilot-toolkit/.github/agents/_template.md
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
#   Put detailed knowledge (syntax, examples, patterns) in a skill or workflow
#   file and let the agent read_file on demand. This avoids wasting context
#   tokens. Design rationale belongs in the commit and the issue, not a file.
#
description: Template prompt
tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'browser', 'agent', 'todo']
# Uncomment to add MCP servers:
# tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'browser', 'agent', 'todo', '<server-name>/*']
---

Your task: ${input:task:describe the task}.

## Steps

1. First step
2. Second step

## Output

Describe expected output format.
