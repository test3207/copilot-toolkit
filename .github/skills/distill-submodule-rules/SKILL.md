---
name: distill-submodule-rules
description: Distill a submodule's own Copilot rules (`.github/copilot-instructions.md` + companion `instructions/` files) into a host-side glob-triggered file at `.github/instructions/repos-<name>.instructions.md`. Runs after `onboard-repo` (or on drift) so the host agent gets the submodule's hard rules whenever it edits files under that submodule path. VS Code only auto-loads the workspace-root `.github/copilot-instructions.md`, so a mounted submodule's own constitution would otherwise stay invisible — this skill closes that gap.
user-invocable: false
---

# Distill submodule rules

When a downstream submodule mounted at `repos/<name>/` carries its own
`.github/copilot-instructions.md`, VS Code Copilot does NOT auto-load it
in the host workspace — only the host's root `.github/copilot-instructions.md`
loads automatically. This skill distills the submodule's hard rules into
a host-side `.github/instructions/repos-<name>.instructions.md` with
`applyTo: "repos/<name>/**"`, so the rules auto-load whenever the agent
reads or edits anything under that submodule.

## When to use this skill

- Called as the last step of `/onboard-repo` for any newly mounted submodule.
- Called on demand when the submodule's `.github/copilot-instructions.md`
  has drifted from the source-snapshot sha recorded in the host file.
- Called manually when the host agent is observed violating a submodule's
  hard rule that should have been carried over.

When NOT to use it:

- The submodule has no `.github/copilot-instructions.md` AND no
  `.github/instructions/*.instructions.md` — there is nothing to distill.
  Report this and skip; do not write an empty file.

## Inputs

- `name` (required) — the submodule directory name under `repos/`, e.g. `infra`.
  All paths below use `repos/<name>/...`.

## Workflow

### Step 1 — Locate and snapshot the source

Check `repos/<name>/.github/copilot-instructions.md` exists. If absent,
check whether `repos/<name>/.github/instructions/` has any
`*.instructions.md` files. If both absent, STOP and report "nothing to
distill"; do not write any file.

Capture the source sha of the L3 constitution (or, if absent, of the
newest L3 instructions file):

```pwsh
git -C repos/<name> log -1 --format='%H %ci' -- .github/copilot-instructions.md
```

### Step 2 — Read source material

Read in order:

1. `repos/<name>/.github/copilot-instructions.md` (full) — primary source.
2. Every `repos/<name>/.github/instructions/*.instructions.md` — scan for
   hard rules ("never", "always", "must") that aren't already in the
   constitution.

Do NOT read `repos/<name>/.github/skills/*` or
`repos/<name>/.github/prompts/*` for distillation content — those are
procedural how-to, not host-loaded rules. They stay as L3 reference.

### Step 3 — Distill

Pick out, in this order:

1. **Hard rules / red lines** — anything the submodule constitution
   marks "never", "must", "do not", "forbidden". These are the must-have
   payload — host agent will violate them if not carried over.
2. **Domain facts the host agent needs to act safely** — canonical
   names (server roster, environment list, alias bans), key endpoints,
   key entry points (specific scripts the agent is expected to call
   instead of writing one-offs).
3. **Cross-shell / wrapping conventions** if present (e.g. `pwsh -NoProfile -File`
   wrappers).
4. **Commit / push consent words** if the submodule has its own — the
   host's defaults may differ.
5. **Explicit exclusions** — a short section naming what is NOT carried
   over so the host agent doesn't expect it (procedural skills, repo-internal
   `/memories/repo/*` rituals, L3-relative applyTo globs).

Do NOT carry:

- The submodule's `.github/skills/` procedures — read from L3 on demand.
- The submodule's `.github/prompts/` workflows — same.
- `/memories/repo/*` references — those live in the submodule's OWN
  workspace storage, not the host's.
- L3 instructions files' `applyTo:` globs — they are repo-relative and
  won't fire correctly from the host.

### Step 4 — Adapt paths

Every relative path in the source material is L3-relative. In the host
file it must be prepended with `repos/<name>/`:

- `scripts/x.ps1` → `repos/<name>/scripts/x.ps1`
- `.\deploy.ps1` → `repos/<name>/<server>/deploy.ps1` (or whichever subdir)
- Markdown links: rewrite as `../../repos/<name>/<path>` (relative to
  `.github/instructions/`).

### Step 5 — Write the host file

Write `.github/instructions/repos-<name>.instructions.md` with:

```markdown
---
applyTo: "repos/<name>/**"
---

# repos/<name> — distilled hard rules (host-side)

> Distilled from `repos/<name>/.github/copilot-instructions.md`.
> Loaded automatically when the host agent reads / edits any path under
> `repos/<name>/**`. The submodule itself remains the source of truth;
> read it on demand for procedural detail.
>
> **Source snapshot**: `<sha>` (<date>). If the submodule constitution
> diverges from this distillation, this file wins for host sessions —
> reconcile by re-running `distill-submodule-rules` and bumping the sha.

## Hard rules (red lines)
...
## Domain facts
...
## On-demand references
...
## What this file does NOT carry from the submodule
...
```

If the file already exists (drift re-run), preserve any user-added
content below a `<!-- host-only additions below -->` marker if present;
above the marker is regenerated.

### Step 6 — Report

Show:

- Output path: `.github/instructions/repos-<name>.instructions.md`
- Source sha captured + date
- Counts: hard rules carried / domain facts carried / sections excluded
- If this was a drift refresh: the old sha → new sha diff
- Reminder: this file is host-local; commit it to the host repo (not
  the submodule).

## Rules

- **Distillation is curation, not copy.** The point is to give the host
  agent enough to NOT violate the submodule's red lines — not to mirror
  the entire constitution. If the host file grows past ~150 lines,
  re-trim; the longest single rule explanation should be one short
  paragraph.
- **No L3-relative `applyTo`.** The host file's frontmatter ALWAYS uses
  `applyTo: "repos/<name>/**"`. Never copy a L3 instruction file's
  `applyTo:` glob — it will not match anything from the host.
- **No `/memories/repo/*` carry-over.** Those are workspace-local in the
  submodule's own workspace. Mention them under the "NOT carried" section
  if the source references them.
- **Source-snapshot sha is mandatory.** Without it, drift detection is
  impossible. If the source file has no git history (untracked), record
  `untracked` and a content hash instead.
- **No auto-sync.** This skill runs only when invoked — by `onboard-repo`,
  by a drift-refresh request, or by a user spotting a violation. Do not
  wire it to a scheduled job.

## References

- The `onboard-repo` skill calls this as its final step. If you change
  the output path or the front-matter shape, update
  `../onboard-repo/SKILL.md` step 8 in the same commit.
