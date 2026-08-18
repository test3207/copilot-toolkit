# Shared: Feature Gating Decision → Implement → Test → PR

Shared steps for both Feature and Bug workflows. Read after type-specific analysis is confirmed.

The main agent does NOT load coding-standards or feature-gating execution detail
from here — the `work-implementer` subagent loads those in its own window.

---

## Feature Gating Decision (Phase 3.5)

IF repo registry has `feature-gating` field, decide WITH USER which scenario
applies. Do NOT read the gating execution doc — record only the decision in the
spec; the implementer will read the execution doc on its side.

| Scenario | Decision to record in spec |
| -------- | -------------------------- |
| New control | Create lifecycle tracked item via provider `createItem({ type: "feature", title, body })` now; record gate name + flight name + item id |
| Reuse existing control | Look up the gate from existing FeatureMapping; record existing name + item id |
| Retiring a control | Record which control to remove |

The lifecycle item MUST be created by the main agent (subagent has no provider tool access).

---

## Implement

**Default: the main agent does NOT edit code.** The `work-implementer` subagent does.
**Exception (per `work.prompt.md` MANDATORY rule)**: a confirmed Light change — a
one-line typo, a single-value config tweak — MAY be applied inline by the main
agent without writing a spec. Everything Medium / Full / Standard / Deep MUST be
dispatched.

### 1. Write spec to `metrics/work/<item-id>/spec.md`

Template (~25 lines):

```markdown
# Implementation Spec — Item <id>: <title>

## Context
- Intent: <one paragraph>
- Repo path: <from registry>
- Coding standards: <ordered list from registry>
- Feature-gating file: <path or N/A>
- Build command: <from registry>

## Feature Gate (if applicable)
- Feature name: <FeatureName>
- Flight: <Portal_Xxx> | Gate: <gateName> | Lifecycle item: <id>
- Scenario: new | reuse | retire

## Touch Points
| # | File | Change | Constraints / Reuse |
| - | ---- | ------ | ------------------- |
| 1 | `<path>` | <concrete change> | use existing X at `<file#line>`; do NOT duplicate Y |

## Boundary Literals (DAP-08, only if external-contract literals appear)
| Literal | Source citation (telemetry / sibling-handler / service-source / user-pasted) |
| ------- | -------------------------------------------------------------------------- |

## Test Requirements
- UT: required at `<test path>` | not required (`<framework reason>`)
- Manual cases (for user):
  | Case | Steps | Expected |

## Notes
<anything implementer needs to know>
```

### 2. Dispatch `work-implementer`

Pass in the prompt: `toolkit-root` (from main agent), `spec-path`, `repo-path`, `registry-path`, `coding-standards`
list, `feature-gating-file` (or `N/A`), `anti-patterns-file`
(`{toolkit-root}/skills/work/anti-patterns/design.md`). The implementer reads
files, edits, builds, runs UTs, audits DAP-07/08, and returns a compact summary.

### 3. Review the returned summary

- IF `status: blocked` -> resolve the cited question (read the cited file range
  yourself, or ask user) then re-dispatch with an updated spec. Do NOT escalate
  to "I'll write the code myself" — that defeats the context-isolation gain.
- IF `status: complete` -> **MANDATORY: closure validation before user
  acknowledgement.** In a **single parallel `runSubagent` block**, dispatch
  `work-closure-direction-validator` AND `work-closure-detail-validator` with
  inputs:
  - `toolkit-root`: same value passed to implementer
  - `repo-path`: same value passed to implementer. Bounds every search the
    validators run; without it they grep the whole workspace and report hits in
    sibling repos as missed edits.
  - `extra-scopes` (optional): additional workspace-relative paths that ARE in
    scope, for a change that deliberately spans repos — e.g. a file moved from
    one repo to another, where the old location is the thing worth checking.
    Omit for a single-repo change; omitting it keeps the search inside
    `repo-path`.
  - `outputDir`: `tmp/work/<item-id>/`
  - `request`: the original user request that led to this work item.
    When the request contains a universal claim (`every X is …`, `all Y are
    …`, `no Z does …`), spell out the SCOPE of that claim — which files /
    which subsystem the claim covers — so the validator doesn't generalize
    it across the whole repo (e.g. "every `v1.x.y` literal in the tree is
    fictional" must say "only in `install/`, `scripts/`, `INSTALL.md`,
    `README.md`" if other dirs intentionally carry their own version
    literals).
  - `implementerSummary`: the verbatim summary just returned
  - `changedPaths`: file list from the implementer summary's "Files Modified" table
  - `scope`: `all-changes-since-handoff`

  Then read both compact response summaries and apply the gate per finding:
  - **Auto-bounce**: finding has `confidence=high AND impact=low`. Re-dispatch
    `work-implementer` with the finding appended to the spec's Notes section.
  - **Surface to user** (stop): every other combination. Present the implementer
    summary
    AND the validator findings (counts per severity per validator + brief
    one-line description per finding, with paths to the full section files at
    `tmp/work/<item-id>/50-direction.md` and `51-detail.md`). Wait for the
    user's response before doing anything else.

  Self-check: if your next planned action after implementer returns is anything
  other than the parallel validator dispatch above, **STOP** and dispatch.

---

## Test

The implementer's returned `Suggested Manual Test Cases` is what the user runs
locally. The main agent relays it. **Required coverage**: happy paths +
user-impacting error scenarios + edge cases identified in design phase.

---

## PR

After user acknowledges the implementation summary:

- Generate commit message: `<type>: <description><provider.commitMessageSuffix(itemId)>` — types:
  feat, fix, refactor, docs, test, chore. ADO provider yields `(WI-12345)`; GitHub provider yields `(#42)`.
- Stage + commit + push from the main agent (implementer left a clean diff).
- Create PR (MCP: `repo_create_pull_request` for ADO; `gh pr create` for GitHub)
  - For ADO: repository ID = `repo-guid` from registry (not repo name); target branch = `branch` from registry; MCP server = `ado-repo-server` from registry.
  - For GitHub: `gh pr create --repo <github-repo> --base <branch> --head <feature-branch>`; PR body includes `provider.prDescriptionLink(itemId)` (e.g. `Closes #42` for auto-close).
- **Tracked-item linking**: call provider `linkPR(itemId, prUrl)`. ADO provider links via MCP relation when `ado-repo-server == ado-wi-server`, else falls back to manual cross-paste. GitHub provider relies on the `Closes #<id>` line already in the PR body — no extra call.
- **PR Description**:
  - IF registry has `pr-template`: read template, copy verbatim, fill placeholders
  - IF no `pr-template`: write a clear description with summary, changes, test info

**Required info** (if applicable):

1. Tracked-item link (provider `prDescriptionLink(itemId)`)
2. Feature gating info (if repo has `feature-gating`)
3. If PR size >= 200 lines: Recording URL (ask user)
