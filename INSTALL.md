# Installing copilot-toolkit in a consumer repo

This toolkit ships as a content overlay mounted at `.copilot-toolkit/` in the
consumer's working tree. Two mount modes are supported:

| Mode | Update mechanism | When to pick |
| --- | --- | --- |
| **Submodule** | `git submodule update --remote` (or `git submodule add -b <tag>` for a fresh pin) | Default. Mount path is a git submodule; VS Code sees upstream changes immediately after `git submodule update`. |
| **Sync** | `node .copilot-toolkit/install/sync.mjs --tag vX.Y.Z` | Consumer can't use submodules (policy, monorepo, etc.) or wants explicit per-tag opt-in with no transitive git surface. |

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

Where a release tag belongs, this document writes a placeholder -- usually
`<tag>`, sometimes `vX.Y.Z`. Pick a real tag from
[Releases](https://github.com/test3207/copilot-toolkit/releases) and substitute
it. No specific version is named anywhere here, so there is nothing to go stale.

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
* Node.js 24+ on PATH. Use a supported LTS release; Node 24 LTS is recommended.
  The consumer-reachable helpers under `scripts/` are Node, and `run-safe.mjs`
  additionally needs PowerShell 7 on Windows.

**Steps** (run from the consumer repo root)

```pwsh
# 1. Add the submodule pinned to a release tag (see Releases, linked above).
git submodule add -b <tag> https://github.com/test3207/copilot-toolkit.git .copilot-toolkit

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
git commit -m "Add copilot-toolkit submodule (<tag>)"
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
files directly. Updates require re-running the sync script. Sync still delivers
the selected Git tag's source tree, not a built Release bundle.

**Prereqs**

* Git 2.29+ and Node.js 24+ on PATH. Use a supported LTS release; Node 24 LTS
  is recommended. Sync now uses Git's explicit object-format
  initialization to match the source's SHA-1 or SHA-256 format, independent of
  inherited defaults. The standalone installer uses only Node built-ins;
  it needs no npm install, companion files, PowerShell, Bash, or hash utility.
* Consumer accepts that `.copilot-toolkit/` content is checked in to the
  consumer repo (increases repo size, but avoids submodule UX).

**Steps** (run from the consumer repo root)

Download a single [`install/sync.mjs`](install/sync.mjs) from a modern tag
containing that file. Set `<bootstrap-tag>` to that tag, independently of the
`<tag>` you want to install. Older target tags do not contain the Node entry
point, but the modern bootstrap can still install them. Download through your
browser or use either acquisition recipe below; the installer itself runs in
any shell and resolves its destination from the current directory.

```pwsh
# 1. Download a modern standalone bootstrap; the target tag can be older.
$bootstrapTag = '<bootstrap-tag>'
$tag = '<tag>'
Invoke-WebRequest "https://raw.githubusercontent.com/test3207/copilot-toolkit/$bootstrapTag/install/sync.mjs" -OutFile sync-bootstrap.mjs

# 2. Run it. Populates .copilot-toolkit/ and writes .copilot-toolkit/.sync-lock.
node sync-bootstrap.mjs --tag $tag

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
Remove-Item sync-bootstrap.mjs
git add .copilot-toolkit .vscode/settings.json .github/copilot-instructions.md
git commit -m "Add copilot-toolkit (sync mode, <tag>)"
```

Bash acquisition and execution equivalent (Linux / macOS):

```bash
bootstrap_tag='<bootstrap-tag>'
tag='<tag>'
curl -fsSL "https://raw.githubusercontent.com/test3207/copilot-toolkit/$bootstrap_tag/install/sync.mjs" -o sync-bootstrap.mjs
node sync-bootstrap.mjs --tag "$tag"
rm sync-bootstrap.mjs
```

Settings, project instructions, and registry setup remain manual. The separate
init handoff is pending (#45); there is no init command to invoke here.

### Sync safety and compatibility

* `--repo <url-or-path>` selects another Git upstream. `--tag vX.Y.Z` is explicit
  and must name a tag, not a same-named branch. Exit codes: `0` success,
  `1` operational failure, `2` invalid invocation. Use `--help` for syntax.
* The existing `.sync-lock` metadata and SHA-256 manifest format is retained,
  including support for LF, CRLF and BOM locks. New manifests include `.github`,
  dotfiles and Windows-hidden ordinary files, but not root `.git` or the lock
  itself. A legacy root-lock self-entry is ignored.
* Initial files preserve raw Git blob bytes and POSIX executable modes. Source
  or global attributes and checkout filters do not transform the payload; the
  root lock is generated separately. Later consumer Git checkouts may convert
  text line endings. Sync accepts a pure LF/CRLF difference only when the
  alternate bytes match the original lock hash and consumer Git rules establish
  text conversion. Git-clean status alone is not proof; binary, `-text`, filter
  and encoding transformations remain protected, without executing filters.
* Tracked edits refuse sync unless `--force` is supplied. Explicit uninstall
  removes edited tracked files without `--force`. Missing tracked files warn
  and are restored by sync. Untracked additions can be removed
  by replacement. Older installers omitted some hidden files from their locks;
  those unlisted files cannot be protected from edits on the first migration.
* Git checkouts, registered submodules, linked mounts, nonempty unmanaged
  directories and malformed locks are refused even with `--force`. Unsupported
  links or special files in either tree also fail before activation. Consumer
  configuration and Git state are never changed by the installer.
* Filesystem-equivalent file and directory prefixes are checked before payload
  writes, with the same policy for manifest paths and submodule ownership.
  Windows checks case equivalence. macOS conservatively treats case and Unicode
  normalization variants as equivalent, which can refuse otherwise valid paths
  on case-sensitive volumes. Linux names remain case-sensitive.
* Raw materialization, manifest and lock finish in a same-volume staging directory before
  activation. The old tree stays in a backup until activation succeeds and is
  restored if activation fails. Cleanup or restoration failures return `1` and
  report retained paths; the output states when a new installation is already
  active. Inspect those paths before manual recovery or cleanup. This is not
  crash-proof atomicity and does not support concurrent sync operations.

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
git submodule add -b <tag> https://github.com/test3207/copilot-toolkit.git .copilot-toolkit

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
git commit -m "Mount copilot-toolkit submodule (<tag>)"
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
$bootstrapTag = '<bootstrap-tag>'
$tag = '<tag>'
Invoke-WebRequest "https://raw.githubusercontent.com/test3207/copilot-toolkit/$bootstrapTag/install/sync.mjs" -OutFile sync-bootstrap.mjs
node sync-bootstrap.mjs --tag $tag
Remove-Item sync-bootstrap.mjs

# Hand-merge .vscode/settings.json as in Scenario 3 step 2.

git add .copilot-toolkit .vscode/settings.json
git commit -m "Mount copilot-toolkit (sync, <tag>)"
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

# Pick a tag from the list above and check it out inside the submodule.
git -C .copilot-toolkit checkout <tag>

# Pin the new SHA in the parent repo.
git add .copilot-toolkit
git commit -m "Upgrade copilot-toolkit submodule -> <tag>"
```

If you originally added the submodule with `-b <tag>`, also update
`.gitmodules` if you want `git submodule update --remote` to follow the new
tag:

```pwsh
git config -f .gitmodules submodule..copilot-toolkit.branch <tag>
git add .gitmodules
git commit --amend --no-edit
```

### Sync mode

```pwsh
# Use the installed Node entry point when the current tag contains it.
node .copilot-toolkit/install/sync.mjs --tag <tag>

# The script will REFUSE if it detects local edits inside .copilot-toolkit/.
# To override (and discard those edits), add --force.

git add .copilot-toolkit
git commit -m "Sync copilot-toolkit -> <tag>"
```

If the current tag predates the Node entry point, re-download a modern bootstrap
as in Scenario 2 and run `node sync-bootstrap.mjs --tag <tag>` instead. Use the
same approach to select newer installer behavior independently of the target tag.

**Verify (both modes)**

1. Reload VS Code.
2. Trigger a representative skill end-to-end (the consumer's repo-specific
   smoke test list, if any).
3. **Check your own instructions file for helper paths that moved.** The toolkit
   does not write to your `.github/copilot-instructions.md`, so anything you
   copied from `templates/copilot-instructions.template.md` -- or any prose or
   recipe of your own that invokes a `scripts/` helper -- keeps naming whatever
   path was current when you wrote it. Grep your repo for `.copilot-toolkit/scripts/`
   and confirm each hit still exists at the tag you just moved to, and that its
   options and exit codes still mean what your recipe assumes; a stale
   invocation fails at run time, and a stale one inside a gate recipe can fail
   *open*.
4. If a skill misbehaves: check the upstream changelog between the previous
   tag and the new tag, then either roll back (Scenario 6) or file an issue
   upstream.

---

## Scenario 6: Uninstall / rollback

### Submodule mode

```pwsh
git submodule deinit -f .copilot-toolkit
git rm -f .copilot-toolkit
Remove-Item -Recurse -Force .git/modules/.copilot-toolkit -ErrorAction SilentlyContinue
# Remove the three toolkit keys from .vscode/settings.json by hand.
git add .gitmodules .vscode/settings.json
git commit -m "Remove copilot-toolkit submodule"
```

### Sync mode

```pwsh
node .copilot-toolkit/install/sync.mjs --uninstall
# Remove the three toolkit keys from .vscode/settings.json by hand.
git add .copilot-toolkit .vscode/settings.json
git commit -m "Remove copilot-toolkit (sync)"
```

For an older tag, use the standalone bootstrap from Scenario 2:
`node sync-bootstrap.mjs --uninstall`. It also allows repeated uninstall after
the mount is absent. Explicit uninstall removes local edits without `--force`;
ownership, lock-path and link checks still apply, even with `--force`.

### Rolling back to a previous tag

* Submodule: `git -C .copilot-toolkit checkout vX.Y.Z-previous`, then
  `git add .copilot-toolkit && git commit -m "Roll back to vX.Y.Z-previous"`.
* Sync: keep a modern bootstrap **outside** `.copilot-toolkit/` before rollback.
  Download it as in Scenario 2, or copy the installed Node entry point to
  `sync-bootstrap.mjs` if it exists. Run
  `node sync-bootstrap.mjs --tag <previous-tag>` (a real `vX.Y.Z` tag); add
  `--force` only to discard tracked edits. An older target can remove the newer
  installed entry point, so retain this bootstrap for later sync or uninstall.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `/` menu doesn't show toolkit skills after install | Settings paths wrong or window not reloaded | Run `Developer: Reload Window`; verify the three settings keys point at `.copilot-toolkit/.github/skills` / `.copilot-toolkit/.github/agents` / `.copilot-toolkit/.github/prompts` (not bare `.copilot-toolkit/skills`). |
| `git submodule update --remote` does nothing | `.gitmodules` has no `branch` entry pinned | `git config -f .gitmodules submodule..copilot-toolkit.branch vX.Y.Z` (then commit). |
| `node .copilot-toolkit/install/sync.mjs --tag vX.Y.Z` refuses with "Local edits detected" | One or more files inside `.copilot-toolkit/` differ from the previously-synced manifest (`.copilot-toolkit/.sync-lock`) beyond permitted text newline equivalence | Either restore the file to its upstream content, or add `--force` to overwrite and discard the local edit. Never edit files inside `.copilot-toolkit/` -- propose the change upstream instead. |
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
