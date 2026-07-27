<!--
copilot-instructions.template.md (toolkit-shipped starter)

Drop this at `.github/copilot-instructions.md` in a new consumer repo, then fill in
every `{{PLACEHOLDER}}` block with your project values. Sections marked OPTIONAL
can be deleted if they don't apply.

This file is loaded into every chat as system instructions, so keep it terse.

Drift gate: the toolkit ships `scripts/lint-public.ps1` (scans for host markers -
internal org names, GUIDs, internal PR refs) and `scripts/lint-recipes.mjs` (flags
multi-step inline `pwsh`/`bash` blocks in skill/prompt recipes - the "recipe glue =
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

- Language: English only (code, comments, docs)
- Use ES Modules (`import`/`export`)
- Prefer `const` over `let`
- **No emojis** in committed text -- many enterprise systems (ICM, some PR review
  surfaces) reject or mangle them

## Terminal Safety (applies to main agent AND subagents)

The terminal tool cannot recover from interactive prompts. A `Read-Host`, git pager,
or auth prompt = silent hang.

**Rules**:

- Always `git --no-pager <cmd>`. Never bare `git log` / `git diff` / `git show`.
- Nested pwsh: pass `-NonInteractive -NoProfile` (Read-Host then throws instead of
  pending).
- Wrap unknown-duration / external commands in `scripts/run-safe.ps1` (hard
  timeout + closed stdin + pager defang).
  - Usage: `pwsh -File .copilot-toolkit/scripts/run-safe.ps1 -Command "<cmd>" -TimeoutSec <n>`
  - Returns `124` on timeout (process killed).
- **No inline temp scripts -- write a `.mjs`, then run it.** If logic needs more than a
  single command (loops, JSON parsing, multi-step git, conditionals), write a Node
  ES-module to a file and run `node <file>` -- do NOT assemble a multi-line
  `pwsh`/`bash` blob on the terminal. Inline shell breaks on cross-platform
  quoting/escaping (e.g. `pwsh -File` vs `-Command` arg binding) and is unreadable in
  history. Node is the one runtime every consumer has (preflight enforces it). Single
  commands (`git --no-pager ...`, `node scripts/x.mjs ...`) stay inline.
- Never `Start-Sleep` to wait for a previous command -- you get auto-notified when
  it completes.
- For env-level git defang in long scripts:
  `$env:GIT_PAGER='cat'; $env:GIT_TERMINAL_PROMPT='0'`.

See `/memories/terminal-safety.md` for the full anti-pattern list and symptom
diagnosis (skill ships this; user memory overrides if you've customized).

## Toolkit Mount

This consumer pulls reusable skills, agents, and scripts from the upstream
**copilot-toolkit**. Mount mode is one of:

- **Submodule (preferred)**: toolkit sits at `.copilot-toolkit/`. Add to
  `.vscode/settings.json`:

  ```jsonc
  "chat.agentSkillsLocations": { ".copilot-toolkit/.github/skills": true },
  "chat.agentFilesLocations":  { ".copilot-toolkit/.github/agents":  true }
  ```

- **Sync script**: `<toolkit>/install/sync.ps1` copies `.github/skills/` and
  `.github/agents/` from the upstream tag into this consumer's `.github/skills/`
  and `.github/agents/`. Each synced file carries an `<!-- AUTO-SYNCED FROM ... -->`
  header. The pre-commit hook refuses local edits to synced files unless bypassed
  with `--no-verify`.

Whichever mode, **never edit toolkit-shipped files directly in this consumer**.
File a PR upstream and re-pull. Consumer-only skills, agents, and prompts live
in paths NOT shared with the toolkit (e.g. consumer-only `.github/skills/<my-tool>/`,
the repo registry, or a separate `.github/prompts/` file you own).

## Project Structure

```
<consumer-repo>/
├── .copilot-toolkit/             # OPTIONAL: submodule mount of upstream toolkit
├── .github/
│   ├── copilot-instructions.md   # This file (always loaded)
│   ├── agents/                   # Consumer-only subagents
│   ├── instructions/             # Domain-specific .instructions.md (auto-loaded)
│   ├── prompts/                  # Consumer-only / thin-shim prompt files
│   └── skills/                   # (sync mode) toolkit skills land here
├── .vscode/
│   ├── mcp.json                  # MCP server config (consumer-specific)
│   └── settings.json
├── docs/
│   ├── index.md                  # Dashboard - tool status overview
│   ├── backlog.md                # Task queue (Ready -> Done)
│   └── tools/                    # Per-tool consumer docs
├── repos/
│   └── <submodules>/             # Managed via registry
└── README.md
```

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
seam** between generic workflow logic and consumer-specific identifiers
(see toolkit Architectural Decision 4).

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
The toolkit ships skills (`/dep-audit`, etc.); consumer prompts are thin shims OR
fully consumer-private. Example:

| Prompt | Purpose |
|--------|---------|
| `/tool-dev` | Create, update, or review tools (skill: tool-dev) |
| `/oncall`   | Oncall incident investigation (consumer-private) |
| `/work`     | Daily dev with WI integration (skill: work) |
}}

**Before creating any prompt file**: Read `.github/prompts/_template.prompt.md` first.

**Before creating any agent file**: Read `.github/agents/_template.md` first.

**Before creating tool doc**: Read `docs/tools/tool-dev.md` as reference.

## Documentation Rules

- **Dashboard**: `docs/index.md` tracks all tools and their status.
- **Tool docs**: Each tool has `docs/tools/<name>.md` with usage, implementation,
  changelog, TODO.
- **Status values**: `stable`, `active`, `planned`, `blocked`.
- **After any tool change**: update status in dashboard + add changelog entry.

## Helper-script hygiene (applies to every `tools/<name>/` dir)

Shared helper directories hold **reusable parameterized scripts only**. Before
adding any new file:

- **Prefer Node for new helpers** -- a committed helper defaults to a `.mjs` run via
  `node` (the runtime preflight guarantees). Reach for PowerShell/bash only when it must
  run before Node exists (install / bootstrap) or needs a shell-native capability Node
  can't reasonably do -- and say why in the header.
- **Banned filename patterns**: `<name>-<YYYY-MM>.ps1`, `<name>-v2.ps1`,
  `<name>-new.ps1`, `backfill-<id>.ps1`. If the work is one-shot, do it inline or
  write to `metrics/<tool>/<scope>/scratch/` -- do NOT land it as a permanent helper.
- **Language-pure dirs stay pure** -- no `.cjs`/`.mjs`/`.py` drops in a PowerShell
  helper dir because of "quick one-off". Either inline it or give it its own subdir.
- **Read the dir's README first**. If a similar script exists, extend it (add a
  `-Switch` / new param). Don't fork.
- **LLM judgment stays in markdown; deterministic glue can be a script.** Subagent
  prompts own the fuzzy reasoning ("did the reviewer accept this refusal?"); script
  helpers own the deterministic glue (counting replies after a timestamp, merging
  JSON by index, parsing checkbox state). Moving glue out of the agent context
  window is a feature -- not a duplicate truth.
- **Every new helper MUST be registered in the dir's README "Scripts" table in the
  same commit**. Undocumented = duplicate fork next session.

See `/memories/tool-creation-lessons.md` -> "Helper-script hygiene" for the
rationale + concrete trap examples.

## Backlog Workflow

- **Task queue**: `docs/backlog.md` -- user adds tasks, agent executes.
- **On "next"**: read backlog, pick top Ready item, execute.
- **After completing**: move task to Done with date, pick next.
- **Priorities**: execute Ready items top-to-bottom unless user specifies.

## Definition of Done

Before marking any task complete:

1. Code works (tested manually or via script).
2. `docs/tools/<name>.md` updated (usage, impl, changelog).
3. `docs/index.md` status updated if needed.
4. `docs/backlog.md` task moved to Done with date.

**Verification steps**:

- CLI Tool: run command and show output to user.
- Prompt: execute prompt once and confirm it works.
- Config change: show affected file diff or run dependent command.

**Test workflow**:

1. Each tool defines **Targets** (functional goals) in its doc.
2. Each target has **Test Cases** (at minimum: happy path).
3. Run test case -> show result -> wait for user to confirm "pass".
4. Mark test case as pass only after user approval.
5. Task complete only when ALL test cases pass.
