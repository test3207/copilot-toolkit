---
# Agent Template
# Docs: https://code.visualstudio.com/docs/copilot/agents/subagents
#
# Header fields (all optional):
#   name                     - Agent name (default: filename)
#   description              - Short description shown in picker
#   tools                    - List of tools to enable (inherits from caller if omitted)
#   model                    - Model to use (default: current selection)
#   user-invocable           - Show in agents dropdown (default: true)
#   disable-model-invocation - Prevent being called as subagent (default: false)
#   agents                   - Restrict which subagents this agent can use ('*' = all)
#
# Visibility matrix:
#   | user-invocable | disable-model-invocation | Result                    |
#   |----------------|--------------------------|---------------------------|
#   | true (default) | false (default)          | User + subagent accessible |
#   | true           | true                     | User-only, no subagent    |
#   | false          | false                    | Subagent-only (hidden)    |
#   | false          | true                     | Inaccessible (don't do)   |
#
# Tool groups (same as prompt files):
#   vscode, execute, read, edit, search, web, browser, agent, todo
#   (browser = experimental, gated by `workbench.browser.enableChatTools`; org-managed, may be unavailable)
#
# MCP server tools (same syntax as prompt files):
#   <server>/*        (all tools from server)
#   <server>/<tool>   (specific tool)
#
# Tips:
#   - Give agents least-privilege tools (reviewer = read+search, not edit)
#   - Use cheaper models for focused/narrow tasks
#   - Subagents don't inherit conversation context — pass all needed info in prompt
#   - Tell the agent what output format to return
#
# Examples:
#
#   Read-only reviewer (subagent-only):
#     ---
#     name: doc-checker
#     description: Verify documentation completeness
#     tools: ['read', 'search']
#     user-invocable: false
#     ---
#
#   Coordinator with restricted subagents:
#     ---
#     name: feature-builder
#     tools: ['read', 'edit', 'search', 'agent']
#     agents: ['planner', 'implementer', 'reviewer']
#     ---
#
#   Fast worker with cheaper model:
#     ---
#     name: formatter
#     tools: ['read', 'edit']
#     user-invokable: false
#     model: ['Claude Haiku 4.5 (copilot)']
#     ---
#
name: template-agent
description: Template agent - copy and customize
tools: ['read', 'search']
user-invocable: false
---

You are a focused worker agent. Your task:

1. Analyze the given input
2. Return structured findings

## Output Format

Return a markdown summary with:
- Key findings
- Recommendations (if any)
