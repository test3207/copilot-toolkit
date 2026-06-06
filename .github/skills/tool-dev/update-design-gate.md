# /tool-dev update — Confirm Design Gate

Loaded on demand by Step 3 of the `update` flow in [SKILL.md](./SKILL.md).
Do not load on every run; the gate body only matters once an `update` is in flight.

## Classify the update

Inspect the **user request text** (the freeform sentence after `/tool-dev update <name>`,
plus any quoted PR / WI / comment the user attached). This is NOT the `${input:name}` /
`${input:action}` slot from the prompt frontmatter.

### Bug-fix triggers (any one match)

- The user request text contains any of: `fix`, `bug`, `false positive`, `false negative`,
  `regression`, `missed`, `broken`, `didn't catch`.
- The user request text references an external PR / WI / user-reported empirical failure
  (`regarding pr:`, `user reported`, `comment says`, a PR URL, a WI id).
- The user request text explicitly requests analysis: `why`, `investigate`, `diagnose`.

### Polish triggers (none of the above match)

Rename, trim changelog, split file, restyle, restructure, add inline note, fix typo, or
any cosmetic / structural cleanup not driven by an observed failure.

## Bug-fix protocol (HARD STOP)

1. Present **Root Cause** with at least one `file:line` evidence citation — the exact
   rule / subagent / workflow line that allowed the failure to slip through.
2. Present **2-3 fix design options** with trade-offs (coverage / false-positive risk /
   complexity / blast radius across other tools).
3. Print exactly:

   ```
   Awaiting design approval — reply with option choice or modifications before I proceed to step 4 (Make changes)
   ```

   and **end turn**. Do not edit any file. Skipping this gate = task failure regardless
   of code quality.

## Polish protocol

Print exactly:

```
Polish update — classification: polish. Proceeding to step 4.
```

and continue to step 4 of the `update` flow without further design review.
