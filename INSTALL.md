# Installing copilot-toolkit in a consumer repo

This toolkit ships as a content overlay mounted at `.copilot-toolkit/` in the
consumer's working tree. Two mount modes are supported:

| Mode | Update mechanism | When to pick |
| --- | --- | --- |
| **Submodule** | `git submodule update --remote` (or `git submodule add -b <tag>` for a fresh pin) | Default. Mount path is a git submodule; VS Code sees upstream changes immediately after `git submodule update`. |
| **Sync** | `pwsh install/sync.ps1 -Tag vX.Y.Z` (or `bash install/sync.sh --tag vX.Y.Z`) | Consumer can't use submodules (policy, monorepo, etc.) or wants explicit per-tag opt-in with no transitive git surface. |

Both modes share:

* Mount path: `.copilot-toolkit/` (relative to consumer repo root).
* Settings snippet: `.vscode/settings.json` entries in
  [`install/settings-snippet.jsonc`](install/settings-snippet.jsonc).
* Discovery: VS Code Copilot Chat picks up `.copilot-toolkit/.github/skills/`,
  `.copilot-toolkit/.github/agents/`, and `.copilot-toolkit/.github/prompts/`
  via those settings.

The consumer's own `.github/skills/`, `.github/agents/`, and
`.github/prompts/` keep working via VS Code's default discovery -- nothing in
this toolkit clobbers them.

Before picking a scenario, skim **MCP server naming convention** below -- the
shipped prompts use neutral server names (`ado-1`, `ado-2`, `kusto-1`,
`incident-1`, ...) that you either match in your `.vscode/mcp.json` or override
locally.

---

## Scenario 1: Fresh consumer + submodule (recommended)

A new repo with no existing copilot toolkit config.

**Prereqs**

* Consumer repo is a git repo with an unmodified `.vscode/settings.json`
  (or none).
* `git` ≥ 2.20 and PowerShell 7 (`pwsh`) on PATH.

**Steps** (run from the consumer repo root)

```pwsh
# 1. Add the submodule pinned to the latest release tag.
git submodule add -b v0.1.0 https://github.com/test3207/copilot-toolkit.git .copilot-toolkit

# 2. Wire discovery in .vscode/settings.json.
#    If the file doesn't exist, create it with the snippet contents below;
#    otherwise merge the three keys in.
New-Item -ItemType Directory -Force -Path .vscode | Out-Null
Copy-Item .copilot-toolkit/install/settings-snippet.jsonc .vscode/settings.json -WhatIf
# Inspect the -WhatIf output. If happy, re-run without -WhatIf, then open the
# file and remove the leading comment block if your tooling rejects // in JSON.

# 3. Copy the project-instructions starter template and fill in the
#    {{PLACEHOLDER}} blocks. This is the system prompt loaded into every
#    chat session, so a missing copilot-instructions.md leaves the agent
#    without project context. The template is shipped under
#    .copilot-toolkit/templates/ and is intentionally NOT auto-installed;
#    every consumer fills it in by hand because the content (project
#    scope, tech stack, MCP mapping) is consumer-specific.
New-Item -ItemType Directory -Force -Path .github | Out-Null
Copy-Item .copilot-toolkit/templates/copilot-instructions.template.md .github/copilot-instructions.md
# Open .github/copilot-instructions.md and fill in every {{PLACEHOLDER}}
# block; delete OPTIONAL sections that don't apply to this consumer.

# 4. Commit the submodule pointer + settings + filled-in instructions.
git add .gitmodules .copilot-toolkit .vscode/settings.json .github/copilot-instructions.md
git commit -m "Add copilot-toolkit submodule (v0.1.0)"
```

**Verify**

1. Reload VS Code: `Ctrl+Shift+P` → `Developer: Reload Window`.
2. Open Copilot Chat. Type `/` and confirm skills from the toolkit appear in
   the menu (e.g. the names listed in
   [`README.md`](README.md#whats-in-here) under `.github/skills/`).
3. Trigger any skill end-to-end (the workspace's own slash commands should
   route correctly).
4. Confirm `.github/copilot-instructions.md` has no remaining
   `{{PLACEHOLDER}}` markers (`Select-String -Pattern '{{PLACEHOLDER' .github/copilot-instructions.md`
   should return nothing).

---

## Scenario 2: Fresh consumer + sync

Same shape as Scenario 1, but no submodule -- consumer commits the synced
files directly. Updates require re-running the sync script.

**Prereqs**

* `git`, `pwsh` (or `bash` + `sha256sum`) on PATH.
* Consumer accepts that `.copilot-toolkit/` content is checked in to the
  consumer repo (increases repo size, but avoids submodule UX).

**Steps** (run from the consumer repo root)

```pwsh
# 1. Download the sync script for the target tag.
$tag = 'v0.1.0'
Invoke-WebRequest "https://raw.githubusercontent.com/test3207/copilot-toolkit/$tag/install/sync.ps1" -OutFile sync-bootstrap.ps1

# 2. Run it. Populates .copilot-toolkit/ and writes .copilot-toolkit/.sync-lock.
pwsh -File sync-bootstrap.ps1 -Tag $tag

# 3. Wire .vscode/settings.json (same as Scenario 1 step 2).
New-Item -ItemType Directory -Force -Path .vscode | Out-Null
Copy-Item .copilot-toolkit/install/settings-snippet.jsonc .vscode/settings.json

# 4. Copy + fill the project-instructions starter template
#    (same as Scenario 1 step 3; see that scenario for rationale).
New-Item -ItemType Directory -Force -Path .github | Out-Null
Copy-Item .copilot-toolkit/templates/copilot-instructions.template.md .github/copilot-instructions.md
# Open .github/copilot-instructions.md and fill in every {{PLACEHOLDER}}
# block; delete OPTIONAL sections that don't apply.

# 5. Commit everything.
Remove-Item sync-bootstrap.ps1
git add .copilot-toolkit .vscode/settings.json .github/copilot-instructions.md
git commit -m "Add copilot-toolkit (sync mode, v0.1.0)"
```

Bash equivalent for step 2 (Linux / macOS):

```bash
tag='v0.1.0'
curl -fsSL "https://raw.githubusercontent.com/test3207/copilot-toolkit/$tag/install/sync.sh" -o sync-bootstrap.sh
bash sync-bootstrap.sh --tag "$tag"
rm sync-bootstrap.sh
```

**Verify**: same as Scenario 1.

---

## Scenario 3: Existing consumer with custom root instruction + submodule

Consumer already has `.github/copilot-instructions.md`, their own
`.github/skills/`, and a populated `.vscode/settings.json`. Don't clobber
any of it.

**Prereqs**

* As Scenario 1.
* Read the consumer's existing `.vscode/settings.json` first -- you'll
  hand-merge.

**Steps**

```pwsh
# 1. Mount the submodule (same as Scenario 1).
git submodule add -b v0.1.0 https://github.com/test3207/copilot-toolkit.git .copilot-toolkit

# 2. Hand-merge .vscode/settings.json. Open it and add the three keys from
#    .copilot-toolkit/install/settings-snippet.jsonc. If the consumer already
#    uses chat.agentSkillsLocations / chat.agentFilesLocations /
#    chat.promptFilesLocations for other dirs, just add the
#    ".copilot-toolkit/.github/skills" / "...agents" / "...prompts" entries
#    alongside the existing entries (the value is a map of path -> bool).

# 3. Confirm the consumer's existing .github/copilot-instructions.md still
#    governs the project. The toolkit ships a STARTER TEMPLATE at
#    .copilot-toolkit/templates/copilot-instructions.template.md for fresh
#    consumers (see Scenarios 1 + 2), but never writes to
#    .github/copilot-instructions.md directly -- your existing file is
#    untouched.
git status .github/copilot-instructions.md
# Expect: no change.

# 4. Commit.
git add .gitmodules .copilot-toolkit .vscode/settings.json
git commit -m "Mount copilot-toolkit submodule (v0.1.0)"
```

**Verify**

1. Reload VS Code.
2. Open Copilot Chat and trigger one of the consumer's own existing skills --
   confirm it still works.
3. Trigger one of the toolkit's skills -- confirm it now works too.
4. `git status` should be clean (no surprise modifications anywhere).

---

## Scenario 4: Existing consumer + sync

As Scenario 3, but mount via sync instead of submodule.

**Steps**

```pwsh
$tag = 'v0.1.0'
Invoke-WebRequest "https://raw.githubusercontent.com/test3207/copilot-toolkit/$tag/install/sync.ps1" -OutFile sync-bootstrap.ps1
pwsh -File sync-bootstrap.ps1 -Tag $tag
Remove-Item sync-bootstrap.ps1

# Hand-merge .vscode/settings.json as in Scenario 3 step 2.

git add .copilot-toolkit .vscode/settings.json
git commit -m "Mount copilot-toolkit (sync, v0.1.0)"
```

**Verify**: same as Scenario 3.

---

## Scenario 5: Upgrade to a newer release

> **If you kept a local copy of something the new release now ships** (a skill,
> an agent, or a prompt you had under your own `.github/`), delete your copy in
> the SAME commit that bumps the toolkit. Two files of the same kind declaring
> the same `name:` have no defined precedence -- VS Code may load either one, so
> a stale local copy can silently shadow the released version.

### Submodule mode

```pwsh
# Inspect what tags are available upstream.
git -C .copilot-toolkit fetch --tags
git -C .copilot-toolkit tag --list 'v*' --sort=-v:refname | Select-Object -First 5

# Pick a tag (example: v0.1.0) and check it out inside the submodule.
git -C .copilot-toolkit checkout v0.1.0

# Pin the new SHA in the parent repo.
git add .copilot-toolkit
git commit -m "Upgrade copilot-toolkit submodule -> v0.1.0"
```

If you originally added the submodule with `-b <tag>`, also update
`.gitmodules` if you want `git submodule update --remote` to follow the new
tag:

```pwsh
git config -f .gitmodules submodule..copilot-toolkit.branch v0.1.0
git add .gitmodules
git commit --amend --no-edit
```

### Sync mode

```pwsh
# Use the previously installed script (or re-download the bootstrap script
# for the new tag if you want the latest sync.ps1 behavior).
pwsh -File .copilot-toolkit/install/sync.ps1 -Tag v0.1.0

# The script will REFUSE if it detects local edits inside .copilot-toolkit/.
# To override (and discard those edits), add -Force.

git add .copilot-toolkit
git commit -m "Sync copilot-toolkit -> v0.1.0"
```

**Verify (both modes)**

1. Reload VS Code.
2. Trigger a representative skill end-to-end (the consumer's repo-specific
   smoke test list, if any).
3. If a skill misbehaves: check the upstream changelog between the previous
   tag and the new tag, then either roll back (Scenario 6) or file an issue
   upstream.

---

## Scenario 6: Uninstall / rollback

### Submodule mode

```pwsh
git submodule deinit -f .copilot-toolkit
git rm -f .copilot-toolkit
Remove-Item -Recurse -Force .git/modules/.copilot-toolkit -ErrorAction SilentlyContinue
# Remove the two keys from .vscode/settings.json by hand.
git add .gitmodules .vscode/settings.json
git commit -m "Remove copilot-toolkit submodule"
```

### Sync mode

```pwsh
pwsh -File .copilot-toolkit/install/sync.ps1 -Uninstall
# Or manually:
#   Remove-Item -Recurse -Force .copilot-toolkit
# Remove the two keys from .vscode/settings.json by hand.
git add .copilot-toolkit .vscode/settings.json
git commit -m "Remove copilot-toolkit (sync)"
```

### Rolling back to a previous tag

* Submodule: `git -C .copilot-toolkit checkout vX.Y.Z-previous`, then
  `git add .copilot-toolkit && git commit -m "Roll back to vX.Y.Z-previous"`.
* Sync: `pwsh -File .copilot-toolkit/install/sync.ps1 -Tag vX.Y.Z-previous -Force`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `/` menu doesn't show toolkit skills after install | Settings paths wrong or window not reloaded | Run `Developer: Reload Window`; verify the three settings keys point at `.copilot-toolkit/.github/skills` / `.copilot-toolkit/.github/agents` / `.copilot-toolkit/.github/prompts` (not bare `.copilot-toolkit/skills`). |
| `git submodule update --remote` does nothing | `.gitmodules` has no `branch` entry pinned | `git config -f .gitmodules submodule..copilot-toolkit.branch vX.Y.Z` (then commit). |
| `sync.ps1 -Tag vX.Y.Z` refuses with "local edit detected" | One or more files inside `.copilot-toolkit/` differ from the previously-synced manifest (`.copilot-toolkit/.sync-lock`) | Either restore the file to its upstream content, or add `-Force` to overwrite and discard the local edit. Never edit files inside `.copilot-toolkit/` -- propose the change upstream instead. |
| Subagent fails with "skill file not found" referencing `.github/skills/<tool>/...` | Subagent didn't receive the `toolkit-root` input from the calling prompt | Verify the consumer's prompt computes `$toolkitRoot = if (Test-Path '.copilot-toolkit/.github') { '.copilot-toolkit/.github' } else { '.github' }` at Step 0 and passes `toolkit-root: $toolkitRoot` to the subagent. |
| Shipped slash command (`/pr-review`, `/work`, etc.) starts but no MCP tools fire | The prompt's `tools:` allowlist references server names (e.g. `ado-1`) that don't exist in the consumer's `.vscode/mcp.json` | Either rename the consumer's mcp.json entries to match the placeholder names (see "MCP server naming convention" below), or copy the prompt to the consumer's own `.github/prompts/` and adjust the `tools:` list. |

---

## MCP server naming convention

The prompts shipped under `.copilot-toolkit/.github/prompts/` reference MCP
servers with neutral numbered placeholders so the toolkit stays host-agnostic.
VS Code resolves each `tools:` entry by exact MCP-server-name match against
`.vscode/mcp.json`; mismatched entries are silently dropped at runtime, so a
naming gap shows up as "the workflow runs but no MCP calls happen".

| Placeholder | Role | Typical consumer mapping |
| --- | --- | --- |
| `ado-1` | Primary ADO org (the code repo's org) | The ADO org that hosts the repos you most often work in. |
| `ado-2` | Secondary ADO org (work items, or repo ops for a second org) | The ADO org that hosts work items if cross-org from `ado-1`, otherwise alias `ado-2` -> same server as `ado-1`. |
| `ado-3` | Tertiary ADO org (used by `/tool-dev` for the consumer's own toolkit / scratch repo PR check-in) | The ADO org that hosts your toolkit / scratch repo. Optional if `/tool-dev` won't push PRs. |
| `kusto-1` | Primary Kusto MCP server (used by `/work`'s optional RCA telemetry step) | Your team's main Kusto cluster MCP. Optional if you don't run Kusto from workflows. |
| `incident-1` | Incident-management MCP server (used by `/pr-review` for bug-fix-PR enrichment, `/tool-dev` for contact lookups) | Your team's incident-management MCP (e.g. PagerDuty, Opsgenie, internal ICM, etc.). Optional. |
| `microsoft-docs` | The Microsoft Learn docs MCP | Kept by name -- public product (`@microsoft/microsoft-docs-mcp` or similar). |
| `playwright` | Playwright browser-automation MCP | Kept by name -- public. |

You have two options to wire the consumer side:

**Option A: rename consumer mcp.json entries to match the placeholders.**
Simplest. The shipped prompts work out of the box. Keep meaningful comments in
`mcp.json` so you remember which real org each numbered slot points at:

```jsonc
{
  "servers": {
    "ado-1": { /* repo org */
      "command": "npx",
      "args": ["-y", "@azure-devops/mcp", "<your-repo-org>"]
    },
    "ado-2": { /* work-item org -- same as ado-1 if single-org */
      "command": "npx",
      "args": ["-y", "@azure-devops/mcp", "<your-wi-org>"]
    },
    "ado-3": { /* your own toolkit / scratch repo org */
      "command": "npx",
      "args": ["-y", "@azure-devops/mcp", "<your-toolkit-org>"]
    },
    "kusto-1": { /* main kusto cluster */ },
    "incident-1": { /* incident-management MCP */ }
  }
}
```

**Option B: keep real names in mcp.json, override individual prompts locally.**
If you want `mcp.json` to read e.g. `ado-myorg` / `kusto-prod-us` / `oncall-x`
for clarity, copy each prompt you actually use into the consumer's own
`.github/prompts/` and rewrite its `tools:` allowlist to your real names. Use
`/tool-dev update <prompt>` to drive the rename and keep the workflow body
intact (which delegates to the upstream skill -- no skill copying needed).

The consumer's registry seam (`.github/prompts/workflows/registry/<repo>.md`)
also carries `ado-repo-server` / `ado-wi-server` fields. Set those to the
**actual mcp.json server name** the workflow should call for that specific
repo (it can differ per repo even when prompts share placeholders).
