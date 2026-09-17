---
description: Audit and fix npm dependency security vulnerabilities
tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'browser', 'agent', 'todo']
---

Invoke the `dep-audit` skill. Resolve `$toolkitRoot = if (Test-Path '.copilot-toolkit/build/.github') { '.copilot-toolkit/build/.github' } elseif (Test-Path 'build/.github') { 'build/.github' } else { throw 'Toolkit runtime not ready; run install/init.mjs --build in the toolkit source checkout.' }` first and pass it to the skill as `toolkit-root: $toolkitRoot` along with any user-provided context (target repo, alert-list file or pasted content). The skill owns the full workflow: input resolution → audit → analyze → plan → fix → verify → handoff.

For this standalone entry and its delegated workflow, resolve toolkit-owned helper/template examples from the parent of `toolkit-root`: `.copilot-toolkit/build/` or self-hosted `build/`. Keep consumer-owned paths and the caller cwd unchanged.

Skill: [dep-audit](../skills/dep-audit/SKILL.md)
