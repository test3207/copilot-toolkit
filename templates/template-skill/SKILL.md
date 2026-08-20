---
# Skill File Template
# Docs: https://code.visualstudio.com/docs/agent-customization/agent-skills
# Spec: https://agentskills.io/specification
#
# IMPORTANT — skills are DIRECTORY packages, not single files
# -----------------------------------------------------------
# Unlike prompts and agents:
#   - Prompt:  single file `<name>.prompt.md`
#   - Agent:   single file `<name>.md`
#   - Skill:   directory `<name>/` containing `SKILL.md` (+ optional scripts, examples, resources)
#
# Hard rules from the spec (violations cause SILENT load failure):
#   - The directory must contain a file literally named `SKILL.md`.
#   - The `name` field in frontmatter MUST equal the parent directory name.
#   - The `name` may contain only lowercase letters, digits, and hyphens (`[a-z0-9-]`), max 64 chars.
#     No slashes, dots, colons, namespace prefixes, or underscores.
#   - `description` is required, max 1024 chars. Describe BOTH capability AND use case so the
#     model knows when to invoke it.
#
# Why this template is hidden (not broken)
# -----------------------------------------------------------
# Both `user-invocable: false` AND `disable-model-invocation: true` are set, so the
# template loads cleanly (no lint errors) but is suppressed from the `/` menu and from
# model auto-invocation. Same approach as `.copilot-toolkit/.github/agents/_template.md` (which sets
# `name: template-agent` + `user-invocable: false`). Do NOT try to hide a template by
# giving it an invalid `name` (e.g. leading underscore) — the spec accepts only
# `[a-z0-9-]`, so VSCode flags it in the editor.
#
# Header fields
# -----------------------------------------------------------
#   name                       REQUIRED — must match parent dir; [a-z0-9-]{1,64}
#   description                REQUIRED — capability + use case, ≤ 1024 chars
#   argument-hint              optional — placeholder shown in chat input after slash command,
#                                         e.g. "[repo] [alert-list]"
#   user-invocable             optional — default true. false = hide from `/` menu but model
#                                         can still auto-load it
#   disable-model-invocation   optional — default false. true = require manual `/` invocation
#   context                    optional (experimental) — default `inline`. `fork` runs the skill
#                                         in a subagent and returns only the final result to the
#                                         parent. Use `fork` when the skill reads many files /
#                                         runs lengthy investigation whose details don't need to
#                                         stay in the main conversation. Requires
#                                         `github.copilot.chat.skillTool.enabled` setting.
#
# Visibility matrix (same shape as agents):
#   | user-invocable | disable-model-invocation | Result                                  |
#   |----------------|--------------------------|------------------------------------------|
#   | true (default) | false (default)          | In `/` menu AND auto-loaded by model     |
#   | false          | false                    | Hidden from `/`, model still auto-loads  |
#   | true           | true                     | In `/` menu, model never auto-loads      |
#   | false          | true                     | Disabled — don't ship this combination   |
#
# Body
# -----------------------------------------------------------
# The body holds the skill's full workflow: what it does, when to use it, step-by-step
# procedure, expected input/output. Reference companion files with relative markdown links —
# the model loads them ONLY when it follows the link (progressive loading, ctx-friendly).
#
# Directory layout
# -----------------------------------------------------------
#   .github/skills/
#     <skill-name>/                       <-- name MUST match the `name` frontmatter field
#       SKILL.md                          <-- required, this file
#       scripts/                          <-- optional, helper scripts referenced from SKILL.md
#         do-thing.ps1
#       examples/                         <-- optional, reference data the skill links to
#         sample-input.json
#       templates/                        <-- optional, files the skill generates from
#         report.md
#
# Default discovery locations (no extra settings needed):
#   .github/skills/      project skills (this repo)
#   .claude/skills/      same — Claude-compatible
#   .agents/skills/      same — generic agents-spec
#   ~/.copilot/skills/   personal skills (user profile)
#
# Reference an extra dir via `chat.agentSkillsLocations` in `.vscode/settings.json`.
#
# Examples
# -----------------------------------------------------------
# Basic skill (user-invocable, model-invocable):
#   ---
#   name: dep-audit
#   description: Audit npm dependencies for CVEs and produce a fix plan. Use when asked to
#     scan a project for vulnerabilities or update outdated packages.
#   ---
#
# Hidden-but-auto-loaded background skill:
#   ---
#   name: ado-conventions
#   description: ADO REST quirks (multi-line PR body, JSON-Patch payload shape, thread status
#     content-type). Auto-loaded when the model handles ADO REST calls.
#   user-invocable: false
#   ---
#
# Forked-context heavy reader:
#   ---
#   name: review-pr
#   description: Review a pull request for quality, style, correctness. Use when asked to
#     review a PR.
#   context: fork
#   ---
#
# Auto-loaded with slash-command hint:
#   ---
#   name: probe-test
#   description: Run AVD ARM probe deployments and summarize results.
#   argument-hint: "[scenario] [--region <r>]"
#   ---
#
name: template-skill
description: Skill template — copy this entire directory, rename it (dir name must equal the new `name` field), then edit frontmatter and body. Hidden from the `/` menu and from model auto-invocation via the two flags below.
user-invocable: false
disable-model-invocation: true
---

# {{Skill display name}}

One- or two-sentence summary. Mirror the `description` field but written in prose.

## When to use this skill

- Trigger phrasing the user might say (e.g. "audit deps", "scan for CVEs").
- Symptoms or contexts where this skill applies.
- When NOT to use it (point to the alternative if there is one).

## Inputs

What the caller must provide (target repo, scope, paths, etc.). If the workflow needs to ask
the user interactively, say so here.

## Workflow

### Step 1 — Short name

What to do. Concrete commands or tool calls. Reference helper scripts as `[script](./scripts/do-thing.ps1)` —
they are only loaded when the link is followed.

### Step 2 — Short name

...

### Step N — Handoff

What to commit, what to tell the user, what to write where.

## Output format

If the skill produces a structured artifact (plan, report, table), document its shape here so
the model emits it consistently.

## Rules

- Hard constraints (e.g. "never edit `node_modules` directly").
- Things to always check before acting.
- Things that look like they should work but don't.

## References

- `./scripts/do-thing.ps1` — what the helper does.
- `./examples/sample-input.json` — reference shape for input.
