---
description: Audit and fix npm dependency security vulnerabilities
tools: ['read', 'edit', 'execute', 'search', 'agent', 'todo']
---

Invoke the `dep-audit` skill. Resolve `$toolkitRoot = if (Test-Path '.copilot-toolkit/.github') { '.copilot-toolkit/.github' } else { '.github' }` first and pass it to the skill as `toolkit-root: $toolkitRoot` along with any user-provided context (target repo, alert-list file or pasted content). The skill owns the full workflow: input resolution → audit → analyze → plan → fix → verify → handoff.

Skill: [dep-audit](../skills/dep-audit/SKILL.md)
