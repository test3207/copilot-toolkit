# copilot-toolkit

Reusable VS Code Copilot skills, agents, and helper scripts. Generic by design;
host-specific routing (ADO org, ICM tenant, kusto cluster) stays in each
consumer's repo, never in this toolkit.

License: MIT.

## What's in here

| Path | Purpose |
| --- | --- |
| `.github/skills/<tool>/SKILL.md` | Reusable skills (entry file each). VS Code default discovery picks these up when you open this repo as a workspace. |
| `.github/agents/<name>.md` | Subagent workers used by the skills. VS Code default discovery picks these up too. |
| `.github/prompts/<name>.prompt.md` | Thin-shim slash-command entry points (`/dep`, `/pr-review`, `/work`, `/tool-dev`, `/onboard-repo`). Each shim owns the MCP `tools:` allowlist and delegates the workflow body to the matching skill. Consumers discover these via `chat.promptFilesLocations` (see `INSTALL.md`). |
| `scripts/` | Helper scripts (`lint-public.ps1`, `parse-input.mjs`, `run-safe.ps1`, `toolkit-check.ps1`). |
| `templates/` | Starter files for new consumers (`_template.prompt.md`, `template-skill/`, `copilot-instructions.template.md`). |
| `install/` | Install helpers (`sync.ps1`, `sync.sh`, `settings-snippet.jsonc`) for sync mode + the `.vscode/settings.json` snippet shared by both mount modes. See `INSTALL.md`. |

## Self-bootstrap (dev loop for skill / agent authors)

Clone this repo and open it in VS Code:

```pwsh
git clone https://github.com/test3207/copilot-toolkit.git
cd copilot-toolkit
code .
```

Skills under `.github/skills/` and agents under `.github/agents/` are picked up
by VS Code's default Copilot Chat discovery -- no settings tweak required.
Trigger any skill via Copilot Chat and iterate.

Before pushing a change, run the drift gate to catch any private /
host-specific identifiers that snuck in:

```pwsh
pwsh -File scripts/lint-public.ps1 -Path .github,scripts,templates,install,INSTALL.md,README.md
```

```pwsh
node scripts/lint-recipes.mjs
```

Run both as separate commands (so neither exit code masks the other); each must exit `0`.
`lint-public.ps1` output = a host-marker leak to sanitize; `lint-recipes.mjs` output = a
multi-step inline `pwsh`/`bash` block in a `.github/skills` / `.github/prompts` recipe that
must move to a `scripts/<name>.mjs` (tool-dev's "recipe glue = Node script" rule).
The `-Exclude` switch exists for documented exceptions only -- never use it to
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
  [`install/sync.ps1`](install/sync.ps1) /
  [`install/sync.sh`](install/sync.sh), pinned via
  `.copilot-toolkit/.sync-lock` (SHA256 manifest catches drift on re-sync).

See [`INSTALL.md`](INSTALL.md) for the six supported scenarios (fresh
consumer, existing consumer, submodule vs sync, upgrade, uninstall) with
exact commands and verification steps. The copy-paste settings snippet lives
at [`install/settings-snippet.jsonc`](install/settings-snippet.jsonc).

Short version (submodule mode):

```pwsh
git submodule add -b v0.1.0 https://github.com/test3207/copilot-toolkit.git .copilot-toolkit
```

then add to the consumer's `.vscode/settings.json`:

```jsonc
{
  "chat.agentSkillsLocations": { ".copilot-toolkit/.github/skills":  true },
  "chat.agentFilesLocations":  { ".copilot-toolkit/.github/agents":  true },
  "chat.promptFilesLocations": { ".copilot-toolkit/.github/prompts": true }
}
```

Reload the VS Code window. Toolkit skills, agents, and prompts now coexist
with the consumer's own `.github/skills/`, `.github/agents/`, and
`.github/prompts/` — with one caveat: two files declaring the same `name:` have
no defined precedence, so if you keep a local copy of something the toolkit also
ships, delete your copy. See INSTALL.md, Upgrade.

## Versioning

Tags are SemVer. Submodule consumers pin a tag (`git submodule add -b vX.Y.Z`)
and bump explicitly; sync-mode consumers carry a version stamp in
`.copilot-toolkit/.sync-lock`.

## Contributing

PRs welcome. Every PR that touches `.github/skills/`, `.github/agents/`,
`scripts/`, `install/`, or any root markdown must:

1. Pass `pwsh -File scripts/lint-public.ps1 -Path .github,scripts,templates,install,INSTALL.md,README.md`
   (exit `0`, no `-Exclude`) AND `node scripts/lint-recipes.mjs` (exit `0`) — the latter
   fails on multi-step inline `pwsh`/`bash` in skill/prompt recipes ("recipe glue = Node script" rule).
2. Keep documentation generic (placeholder org / repo / tenant names).
3. Update the relevant `SKILL.md` if behavior changes.

See [`templates/_template.prompt.md`](templates/_template.prompt.md) and
[`templates/template-skill/SKILL.md`](templates/template-skill/SKILL.md) for
the conventions to follow when authoring new skills.
