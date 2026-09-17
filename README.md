# copilot-toolkit

Reusable VS Code Copilot skills, agents, and helper scripts. Generic by design;
host-specific routing (ADO org, ICM tenant, kusto cluster) stays in each
consumer's repo, never in this toolkit.

License: MIT.

## What's in here

| Path | Purpose |
| --- | --- |
| `.github/skills/<tool>/SKILL.md` | Skill authoring source; execution uses the explicit build under `build/.github/skills/`. |
| `.github/agents/<name>.md` | Subagent authoring source; execution uses `build/.github/agents/`. |
| `.github/prompts/<name>.prompt.md` | Thin-shim slash-command entry points (`/dep`, `/pr-review`, `/work`, `/tool-dev`, `/onboard-repo`). Each shim owns the MCP `tools:` allowlist and delegates the workflow body to the matching skill. Consumers discover these via `chat.promptFilesLocations` (see `INSTALL.md`). |
| `scripts/` | Helper scripts, all Node. The two gates are `lint-public.mjs` and `lint-recipes.mjs`; see Contributing. |
| `templates/` | Starter files for new consumers (`_template.prompt.md`, `template-skill/`, `copilot-instructions.template.md`). |
| `install/` | Shared init (`init.mjs`), package validation and activation (`runtime.mjs`), pinned JSONC parser, standalone acquisition (`sync.mjs`), and tests. See `INSTALL.md`. |
| `build/` | Locally ignored, validated runtime snapshot with raw-byte provenance. No source fallback. |

## Self-bootstrap (dev loop for skill / agent authors)

Clone this repo and open it in VS Code:

```pwsh
git clone https://github.com/test3207/copilot-toolkit.git
cd copilot-toolkit
code .
```

From the checkout root, explicitly build and initialize:

```sh
node install/init.mjs --build
```

This builds the current working-tree inputs without advancing Git, then merges
workspace discovery to `build/.github/`. Self-hosting disables the corresponding
source locations to avoid duplicate discovery. Reload VS Code and verify the
loaded prompt/skill path is in `build/`. After source edits, explicitly run
`node scripts/build.mjs` again; edits do not change the active runtime until a
successful build. There is no watcher or automatic fetch/update.

Before pushing a change, run the drift gate to catch any private /
host-specific identifiers that snuck in:

```pwsh
node scripts/lint-public.mjs --path .github,scripts,templates,install,INSTALL.md,README.md
```

```pwsh
node scripts/lint-recipes.mjs
```

Run both as separate commands (so neither exit code masks the other); each must exit `0`.
`lint-public.mjs` output = a host-marker leak to sanitize; `lint-recipes.mjs` output = a
multi-step inline `pwsh`/`bash` block in a recipe file that
must move to a `scripts/<name>.mjs` (tool-dev's "recipe glue = Node script" rule).
The `--exclude` switch exists for documented exceptions only -- never use it to
silence a real leak.

### MCP server naming convention (in shipped prompts)

The prompts under `.github/prompts/` reference MCP servers with neutral
numbered placeholders so the toolkit stays host-agnostic:

| Placeholder | Role |
| --- | --- |
| `ado-1`, `ado-2`, `ado-3` | ADO orgs (1st / 2nd / 3rd). `ado-1` is typically the repo org; `ado-2` is typically the work-item org if it differs; `ado-3` is for the consumer's own toolkit / scratch repo (used by `tool-dev`'s PR check-in). |
| `kusto-1` | A Kusto MCP server (the primary one a workflow queries). |
| `incident-1` | An incident-management MCP server (e.g. for bug-fix-PR enrichment). |
| `microsoft-docs` | The Microsoft Learn docs MCP (kept by name -- it's a public product). |
| `playwright` | The Playwright MCP (kept by name -- it's public). |

Consumers either (a) name their `.vscode/mcp.json` entries to match these
placeholders (simplest, no override needed), or (b) keep their own real names
and override individual prompts locally via `/tool-dev update <prompt>`.

## Consume from another repo

Two mount modes, both land at `.copilot-toolkit/` in the consumer's working
tree (settings paths and skill-resolution rules are identical for both modes):

* **Submodule** -- mount as a git submodule, pin to a tag, update via
  `git submodule update --remote`.
* **Sync** -- copy the upstream tree in via
  [`install/sync.mjs`](install/sync.mjs) (Node 24+ and Git 2.29+), pinned via
  `.copilot-toolkit/.sync-lock` (SHA256 manifest catches drift on re-sync).
  Use a supported Node LTS release; Node 24 LTS is recommended.

See [`INSTALL.md`](INSTALL.md) for the six supported scenarios (fresh
consumer, existing consumer, submodule vs sync, upgrade, uninstall) with
exact commands and verification steps. Use [shared init](INSTALL.md#build-and-init)
for setup and discovery migration. The
[`install/settings-snippet.jsonc`](install/settings-snippet.jsonc) artifact is
reference-only, not a copy-paste migration procedure.

Short version (submodule mode) -- pick a tag from
[Releases](https://github.com/test3207/copilot-toolkit/releases):

```pwsh
git submodule add -b <tag> https://github.com/test3207/copilot-toolkit.git .copilot-toolkit
```

For a source checkout containing the builder, initialize from the consumer root:

```sh
node .copilot-toolkit/install/init.mjs --build
```

For an already built minimal package, omit `--build`. Ordinary init validates
the selected package and merges JSONC settings without requiring Git, source,
npm or user-profile changes. Historical source tags use their own setup;
sync acquisition is not runtime readiness. Release-asset delivery is planned,
not implemented. See [INSTALL.md](INSTALL.md#build-and-init) for the lifecycle.

Reload the VS Code window. Built toolkit skills, agents, and prompts coexist
with the consumer's own `.github/skills/`, `.github/agents/`, and
`.github/prompts/` — with one caveat: two files of the same kind declaring the
same `name:` have
no defined precedence, so if you keep a local copy of something the toolkit also
ships, delete your copy. See INSTALL.md, Upgrade.

## Versioning

Tags are SemVer. Submodule consumers pin a tag (`git submodule add -b vX.Y.Z`)
and bump explicitly; sync-mode consumers carry a version stamp in
`.copilot-toolkit/.sync-lock`.

## Contributing

PRs welcome. Every PR that touches `.github/skills/`, `.github/agents/`,
`scripts/`, `install/`, or any root markdown must:

1. Pass `node scripts/lint-public.mjs --path .github,scripts,templates,install,INSTALL.md,README.md`
   (exit `0`, no `--exclude`) AND `node scripts/lint-recipes.mjs` (exit `0`) — the latter
   fails on multi-step inline `pwsh`/`bash` in recipe files ("recipe glue = Node script" rule).
2. Keep documentation generic (placeholder org / repo / tenant names).
3. Update the relevant `SKILL.md` if behavior changes.

See [`templates/_template.prompt.md`](templates/_template.prompt.md) and
[`templates/template-skill/SKILL.md`](templates/template-skill/SKILL.md) for
the conventions to follow when authoring new skills.
