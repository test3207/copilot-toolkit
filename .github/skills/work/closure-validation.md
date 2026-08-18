# Closure Validation

Read this when `work-implementer` returns `overall: complete` or `overall: partial`.
[shared.md](./shared.md) Implement step 3 marks this dispatch MANDATORY and sends
you here for the contract.

Both validators run in a **single parallel `runSubagent` block**:
`work-closure-direction-validator` AND `work-closure-detail-validator`. They do
not see each other's output, which is deliberate.

## Inputs

| Input | Value |
| ----- | ----- |
| `toolkit-root` | same value passed to the implementer |
| `repo-path` | same value passed to the implementer |
| `extra-scopes` | optional; additional workspace-relative paths that are in scope |
| `outputDir` | `tmp/work/<item-id>/` |
| `request` | the original user request that led to this work item |
| `implementerSummary` | the verbatim summary just returned |
| `changedPaths` | file list from the implementer summary's "Files Modified" table |
| `oldForms` | detail validator only, optional but strongly recommended; the **Old form replaced** column from the spec's Touch Points |
| `scope` | `all-changes-since-handoff` |

### Why these four carry conditions

**`repo-path`** — Bounds every search the validators run; without it they grep
the whole workspace and report hits in sibling repos as missed edits.

**`extra-scopes`** — additional workspace-relative paths that ARE in scope, for a
change that deliberately spans repos — e.g. a file moved from one repo to
another, where the old location is the thing worth checking. Omit for a
single-repo change; omitting it keeps the search inside `repo-path`.

**`request`** — When the request contains a universal claim (`every X is …`,
`all Y are …`, `no Z does …`), spell out the SCOPE of that claim — which files /
which subsystem the claim covers — so the validator doesn't generalize it across
the whole repo (e.g. "every `v1.x.y` literal in the tree is fictional" must say
"only in `install/`, `scripts/`, `INSTALL.md`, `README.md`" if other dirs
intentionally carry their own version literals).

**`oldForms`** — copy the **Old form replaced** column from the spec's Touch
Points. `changedPaths` carries only final-state paths, so without this the detail
validator has to guess what was renamed — and a rename it never identifies
produces zero checks that read as a clean result. The direction validator does
not take this input; it runs no mandatory checks.

Why the caller supplies this instead of the validators deriving it from a diff:
both hold `read` / `search` only, by design — no `execute`, so no git history —
and a diff would show a changed file without surfacing a renamed symbol or a
relocated version literal anyway.

## Reading the results

Always read `{outputDir}/51-detail.md`. Read `{outputDir}/50-direction.md` when
its compact summary reports `Findings` > 0.

The compact summaries carry counts only — they cannot tell you which finding to
act on. Applying the gate per finding requires that finding's `confidence`,
`impact`, and one-line description, and none of those are in the summary.

## The gate, per finding

- **Auto-bounce**: finding has `confidence=high AND impact=low` AND its verdict is
  not `unverifiable`. Re-dispatch `work-implementer` with the finding appended to
  the spec's Notes section. Two exclusions: it never applies when the implementer
  returned `overall: partial` (that branch forbids auto-bounce outright, whatever
  the confidence and impact), and it never applies to an `unverifiable` finding —
  that verdict means the validator could not check something, which only you can
  fix by re-dispatching it with `oldForms` or `extra-scopes`. Sending it to the
  implementer wastes a bounce round on a party who cannot act on it.
- **Surface to user** (stop): every other combination. Present the implementer
  summary AND the validator findings (counts per severity per validator + brief
  one-line description per finding, with paths to the full section files at
  `{outputDir}/50-direction.md` and `{outputDir}/51-detail.md`). Wait for the
  user's response before doing anything else.

## Auto-bounce is bounded

Closure validation re-runs after each bounce, so without a cap a validator and an
implementer that disagree will loop:

- Record each bounce where it survives. A bounce already appends its finding to
  the spec's Notes section; prefix that entry `auto-bounce round N:`. The section
  files are fixed-path and each round overwrites the last, so they cannot carry
  this history, and conversation state is exactly what a long disagree-loop
  session loses.
- Before auto-bouncing anything, read the spec's Notes section and count the
  existing `auto-bounce round N:` entries. That count, not your memory of this
  session, is the authority. At most **2** rounds per work item; on the 3rd, stop
  and Surface to user regardless of confidence and impact.
- Never auto-bounce the same finding twice. If a Notes entry already records
  substantially the same finding, it is no longer auto-bounceable — Surface to
  user with both the Notes entry and the new report.
