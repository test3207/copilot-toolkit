---
name: distill-submodule-rules
description: Distill a submodule's own Copilot rules (`.github/copilot-instructions.md` + companion `instructions/` files) into a host-side glob-triggered file at `.github/instructions/repos-<name>.instructions.md`. Runs after `onboard-repo` (or on drift) so the host agent gets the submodule's hard rules whenever it edits files under that submodule path. VS Code only auto-loads the workspace-root `.github/copilot-instructions.md`, so a mounted submodule's own constitution would otherwise stay invisible — this skill closes that gap.
user-invocable: false
---

# Distill submodule rules

VS Code auto-loads only the host root `.github/copilot-instructions.md`, so a
submodule mounted at `repos/<name>/` with its own constitution stays invisible in
the host workspace. This skill distills the submodule's hard rules into a host-side
`.github/instructions/repos-<name>.instructions.md` with `applyTo: "repos/<name>/**"`,
so they auto-load whenever the agent touches anything under that submodule.

## When to use this skill

- Last step of `/onboard-repo` for any newly mounted submodule.
- On demand when the constitution drifted from the host file's source-snapshot sha.
- Manually when the host agent violates a submodule hard rule that should have carried over.

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

Do NOT read `repos/<name>/.github/skills/*` or `repos/<name>/.github/prompts/*` for
distillation content — procedural how-to, not host-loaded rules; they stay as L3 reference.

### Step 3 — Distill

Pick out, in this order:

1. **Hard rules / red lines** — anything the submodule constitution
   marks "never", "must", "do not", "forbidden". These are the must-have
   payload — host agent will violate them if not carried over.
2. **Domain facts the host agent needs to act safely** — canonical
   names (server roster, environment list, alias bans), key endpoints,
   key entry points (specific scripts the agent is expected to call
   instead of writing one-offs).
3. **Cross-shell / wrapping conventions** if present (e.g. `pwsh -NoProfile -File`).
4. **Commit / push consent words** if the submodule has its own (host defaults may differ).
5. **Explicit exclusions** — a short section naming what is NOT carried
   over so the host agent doesn't expect it (procedural skills, repo-internal
   `/memories/repo/*` rituals, L3-relative applyTo globs).

Do NOT carry: the submodule's `.github/skills/` procedures or `.github/prompts/`
workflows (read from L3 on demand), `/memories/repo/*` references (submodule-local),
or L3 instruction files' `applyTo:` globs (repo-relative — won't fire from the host).

### Step 4 — Adapt paths

Every relative path in the source is L3-relative; in the host file prepend
`repos/<name>/`:

- `scripts/x.ps1` → `repos/<name>/scripts/x.ps1`
- `.\deploy.ps1` → `repos/<name>/<server>/deploy.ps1` (or whichever subdir)
- Markdown links: `../../repos/<name>/<path>` (relative to `.github/instructions/`).

### Step 5 — Write the host file

Write `.github/instructions/repos-<name>.instructions.md` with:

```markdown
---
applyTo: "repos/<name>/**"
---

# repos/<name> — distilled hard rules (host-side)

> Distilled from `repos/<name>/.github/copilot-instructions.md` (source of truth;
> read it on demand for procedural detail). **Source snapshot**: `<sha>` (<date>) —
> if the submodule constitution diverges, this file wins for host sessions; reconcile
> by re-running `distill-submodule-rules` and bumping the sha.

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
- Reminder: this file is host-local; commit it to the host repo (not the submodule).

## Rules

- **Distillation is curation, not copy.** Give the host agent enough to NOT
  violate the red lines — don't mirror the whole constitution. Past ~150 lines,
  re-trim; longest rule explanation = one short paragraph.
- **No L3-relative `applyTo`.** Host frontmatter ALWAYS uses `applyTo: "repos/<name>/**"`.
  Never copy a L3 file's `applyTo:` glob — it won't match from the host.
- **No `/memories/repo/*` carry-over.** Workspace-local to the submodule; only
  mention them under the "NOT carried" section if the source references them.
- **Source-snapshot sha is mandatory** for drift detection. No git history
  (untracked) → record `untracked` + a content hash instead.
- **No auto-sync.** Runs only when invoked (onboard-repo, drift refresh, or a
  spotted violation). Do not wire it to a scheduled job.

## References

- The `onboard-repo` skill calls this as its final step. If you change
  the output path or the front-matter shape, update
  `../onboard-repo/SKILL.md` step 8 in the same commit.
