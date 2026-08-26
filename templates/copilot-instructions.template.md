<!--
copilot-instructions.template.md (toolkit-shipped starter)

Drop this at `.github/copilot-instructions.md` in a new consumer repo, then fill in
every `{{PLACEHOLDER}}` block with your project values. Sections marked OPTIONAL
can be deleted if they don't apply.

This file is loaded into every chat as system instructions, so keep it terse.

Drift gate: the toolkit ships `scripts/lint-public.mjs` (scans for host markers -
internal org names, GUIDs, internal PR refs) and `scripts/lint-recipes.mjs` (flags
multi-step inline `pwsh`/`bash` blocks in recipe files - the "recipe glue =
Node script" rule). Keep your consumer copy as-is - lint is intended for upstream-side
use, not consumer-side. Your consumer is the right place for your real ADO org /
tenant / GUIDs. Do NOT paste this template's filled-in version back upstream.
-->

# Copilot Instructions

## Project Scope

{{PLACEHOLDER: one-line description of what this workspace is for. e.g.
"Personal workspace for development and oncall tasks; manages multiple codebases
via submodules."}}

## Tech Stack

{{PLACEHOLDER: list languages, frameworks, CLIs the agent will encounter.
Keep generic enough that prompts don't need to re-list. Example:

- Frontend: TypeScript, React
- Backend: C#, .NET
- Tools: Node.js (ES Modules)
- CLI: git
}}

## Code Standards

- **No emojis** in committed text -- many enterprise systems (ICM, some PR review
  surfaces) reject or mangle them

## Terminal Safety (applies to main agent AND subagents)

The terminal tool cannot recover from interactive prompts. A `Read-Host`, git pager,
or auth prompt = silent hang.

**Rules**:

- Always `git --no-pager <cmd>`. Never bare `git log` / `git diff` / `git show`.
- Nested pwsh: pass `-NonInteractive -NoProfile` (Read-Host then throws instead of
  pending).
- Wrap unknown-duration / external commands in `.copilot-toolkit/scripts/run-safe.mjs` (hard
  timeout + closed stdin + pager defang).
  - Usage: `node .copilot-toolkit/scripts/run-safe.mjs --command "<cmd>" --timeout-sec <n>`
  - Returns `124` on timeout (process tree killed).
- **No inline temp scripts -- write a `.mjs`, then run it.** Applies to BOTH committed
  recipe glue AND runtime ad-hoc / throwaway probes. If logic needs more than a single
  command (loops, JSON parsing, multi-step git, conditionals), write a Node ES-module to
  a file and run `node <file>` -- never type a multi-line `pwsh`/`bash`/`node -e` blob at
  the terminal. Multi-line inline scripts hang the terminal in three known ways:
  bracketed-paste corruption (`bash: [200~: command not found`), bash `!` history
  expansion mangling the command, and Git-Bash leading-`/` path mangling / cross-shell
  quote breakage (`pwsh -File` vs `-Command` arg binding). Node is the one runtime every
  consumer has (preflight enforces it). Single commands (`git --no-pager ...`,
  `node .copilot-toolkit/scripts/x.mjs ...`) stay inline.
- Never `Start-Sleep` to wait for a previous command -- you get auto-notified when
  it completes.
- For env-level git defang in long scripts:
  `$env:GIT_PAGER='cat'; $env:GIT_TERMINAL_PROMPT='0'`.

The toolkit ships no companion anti-pattern list. IF you keep one in user memory
(e.g. `/memories/terminal-safety.md`), it extends this section.

## Toolkit Mount

This consumer pulls reusable skills, agents, and scripts from the upstream
**copilot-toolkit**. Mount mode is one of:

- **Submodule (preferred)**: toolkit sits at `.copilot-toolkit/`. Add to
  `.vscode/settings.json`:

  ```jsonc
  "chat.agentSkillsLocations": { ".copilot-toolkit/.github/skills":  true },
  "chat.agentFilesLocations":  { ".copilot-toolkit/.github/agents":  true },
  "chat.promptFilesLocations": { ".copilot-toolkit/.github/prompts": true }
  ```

- **Sync script**: `pwsh -File .copilot-toolkit/install/sync.ps1 -Tag <tag>` (or
  `bash .copilot-toolkit/install/sync.sh --tag <tag>`) clones the upstream tag and
  replaces the whole `.copilot-toolkit/` tree, then records a SHA256 manifest in
  `.copilot-toolkit/.sync-lock`. On re-sync it re-hashes every tracked file and
  refuses to overwrite when it finds a local edit; `-Force` (`--force` for the
  bash script) discards those edits.

Whichever mode, **never edit toolkit-shipped files directly in this consumer**.
File a PR upstream and re-pull. Consumer-only skills, agents, and prompts live
in paths NOT shared with the toolkit (e.g. consumer-only `.github/skills/<my-tool>/`,
the repo registry, or a separate `.github/prompts/` file you own).

## MCP Server Mapping

{{PLACEHOLDER: list the MCP servers wired in `.vscode/mcp.json` and what each one
is used for. The toolkit does NOT mandate any specific MCP server -- this section
is pure consumer routing data. Example shape:

| Server | Backend | Use Case |
|--------|---------|----------|
| `<name>` | `<org/project/etc>` | <one-line purpose> |
}}

## Repo Registry

The toolkit's workflows reference repos by **name only**. All repo metadata
(paths, ADO/GitHub IDs, GUIDs, build commands, ownership) lives in
`.github/prompts/workflows/registry/<repo>.md`. This is the **single boundary
seam** between generic workflow logic and consumer-specific identifiers.

When onboarding a new repo, run `/onboard-repo <repo-url>` -- the workflow
dispatches by URL pattern (ADO / GitHub / generic git) and writes the registry
entry for you. See `registry/index.md` for the lookup table and input
resolution protocol.

## ICM Integration (OPTIONAL)

If your workflow needs to parse Incident Management URLs (oncall tooling), set:

```jsonc
// .vscode/settings.json
"terminal.integrated.env.windows": {
    "ICM_HOST_PATTERN": "{{regex-fragment matching your ICM host}}"
}
// repeat for linux/osx
```

This wires `.copilot-toolkit/scripts/parse-input.mjs` (toolkit-shipped) to recognize your incident
URLs without baking the host name into upstream source.

## Prompts

{{PLACEHOLDER: list the slash-commands this consumer exposes and their purpose.
The toolkit ships slash commands (`/dep`, `/pr-review`, `/work`, `/tool-dev`,
`/onboard-repo`); consumer prompts are thin shims OR fully consumer-private.
Example:

| Prompt | Purpose |
|--------|---------|
| `/tool-dev` | Create, update, or review tools (skill: tool-dev) |
| `/oncall`   | Oncall incident investigation (consumer-private) |
| `/work`     | Daily dev with WI integration (skill: work) |
}}

**Before creating any prompt file**: Read `.copilot-toolkit/templates/_template.prompt.md` first.

**Before creating any agent file**: Read `.copilot-toolkit/.github/agents/_template.md` first.
