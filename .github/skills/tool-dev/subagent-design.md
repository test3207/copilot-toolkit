# Agents (Subagents)

Agents are custom AI agents defined in `.github/agents/`. They can be invoked as **subagents** — isolated workers that run in their own context window and return only a summary to the caller.

## When to Use Subagents

| Scenario | Use Subagent? | Reason |
| --- | --- | --- |
| Parallel independent analysis | Yes | Each perspective runs in isolation, no cross-contamination |
| Research before implementation | Yes | Keeps main agent context clean for actual work |
| Sequential dependent steps | No | Main agent needs intermediate state between steps |
| Simple single-step task | No | Overhead not worth it |

**Rule of thumb**: If a subtask (a) doesn't need the main conversation's context, and (b) its intermediate steps would pollute the main context — use a subagent.

## Agent File Structure

Location: `.github/agents/<name>.md`

```markdown
---
name: agent-name
description: What this agent does (shown in picker)
tools: ['read', 'search']           # Only the tools this agent needs
user-invokable: false                # true = appears in dropdown, false = subagent only
# disable-model-invocation: false    # true = cannot be called as subagent
# model: ['Claude Haiku 4.5 (copilot)']  # Optional: use cheaper model for focused tasks
# agents: ['other-agent']            # Optional: restrict which subagents this agent can use
---

Instructions for the agent.
```

## Key Frontmatter Properties

| Property | Default | Purpose |
| --- | --- | --- |
| `tools` | inherits from caller | Limit tools for least-privilege |
| `user-invokable` | `true` | `false` = hidden from dropdown, subagent-only |
| `disable-model-invocation` | `false` | `true` = cannot be invoked as subagent |
| `agents` | `*` (all) | Restrict which subagents this agent can call |
| `model` | inherits | Use cheaper/faster model for narrow tasks |

## Design Principles

1. **Least-privilege tools** — give each agent only the tools it needs (e.g., reviewer gets `read, search` not `edit`)
2. **Clear task boundary** — agent instructions should define a focused scope
3. **Structured output** — tell the agent what format to return (e.g., "return a markdown table of findings")
4. **No context inheritance** — subagents don't see the main conversation; pass all needed info in the prompt
5. **No circular delegation** — if agent A can invoke agent B, then B must NOT invoke A (directly or transitively). Use `agents: [...]` to enforce this explicitly; avoid `agents: ['*']` in production agents.

## Context Budgets

Subagents run in their own context window. Both their input and output consume tokens.

| Budget | Target | Rationale |
| --- | --- | --- |
| Agent file | ~100 lines | Loaded permanently when invoked |
| Total reference reads | < 200 lines | All files the agent reads during execution |
| Return to caller | < 150 lines | Summary returned to main agent's context |

**Reference manifest** — agent files should declare which references they read, so the designer can verify the total stays within budget:

```markdown
---
name: my-agent
tools: ['read', 'search']
user-invokable: false
---

# My Agent

## References (read on demand)
- `path/to/file-a.md` (~60 lines) — IF condition X
- `path/to/file-b.md` (~40 lines) — always

## Instructions
...
```

This makes context cost visible and auditable.

## Invoking Subagents from Prompts

Add `agent` to the prompt's `tools` list, then name the agents in the instructions. Note: `agents:` is an **agent-only** frontmatter field — prompts cannot use it.

```markdown
---
tools: ['read', 'edit', 'search', 'agent']
---

Use the doc-checker agent to verify documentation completeness.
Use the test-runner agent to execute pending test cases.
Synthesize findings and present a summary.
```

> **Prompt vs Agent**: Prompts enable subagent calls via `tools: [agent]`. Only agent files support `agents: [...]` to restrict which subagents they can invoke.

## Reference Isolation

When a prompt orchestrates subagents, **do not link or name subagent-owned files** in the orchestrator prompt. Agents treat any visible file path as an implicit read target.

| Rule | Rationale |
| --- | --- |
| No links to subagent workflow files | Agent will read them before invoking subagent |
| No "Subagent reads X" descriptions with paths | Same — path visibility triggers reads |
| Subagent-owned file list goes in the agent file only | Agent file is only loaded when the subagent runs |
| Use plain-text prohibition without links | `DO NOT read X` with no `[link](path)` |

## Orchestration Patterns

- **Parallel workers**: multiple subagents analyze different aspects simultaneously, main agent synthesizes
- **Research-then-act**: subagent gathers info, main agent executes based on findings
- **Coordinator/Worker**: orchestrator delegates to planner, implementer, reviewer; iterates until quality bar met
