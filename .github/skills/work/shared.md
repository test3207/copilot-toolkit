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
| # | File | Change | Old form replaced | Constraints / Reuse |
| - | ---- | ------ | ----------------- | ------------------- |
| 1 | `<path>` | <concrete change> | `<old name / path / version literal>` -> `<new>`, or `-` | use existing X at `<file#line>`; do NOT duplicate Y |

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

Fill **Old form replaced** while writing the spec, not later. It is the source of
the `oldForms` input that [closure-validation.md](./closure-validation.md) needs,
and at spec time the old-to-new pair is the substance of what you are describing.
Reconstructed from memory at dispatch time it gets forgotten, and a rename nobody
names is a rename the detail validator never checks.

### 2. Dispatch `work-implementer`

Pass in the prompt: `toolkit-root` (from main agent), `spec-path`, `repo-path`, `registry-path`, `coding-standards`
list, `feature-gating-file` (or `N/A`), `anti-patterns-file`
(`{toolkit-root}/skills/work/anti-patterns/design.md`). The implementer reads
files, edits, builds, runs UTs, audits DAP-07/08, and returns a compact summary.

### 3. Review the returned summary

The implementer reports its outcome in an `overall:` field.

- IF `overall: blocked` -> resolve the cited question (read the cited file range
  yourself, or ask user) then re-dispatch with an updated spec. Do NOT escalate
  to "I'll write the code myself" — that defeats the context-isolation gain.
- IF `overall: partial` -> closure validation still fires, against what was
  actually done. Afterwards always **Surface to user**: present the validator
  findings together with the remainder the implementer did not finish. Never
  auto-bounce a `partial`; the unfinished remainder is a user decision, not a
  validator finding.
- IF `overall: complete` -> closure validation fires.

**On `complete` and on `partial` only — MANDATORY: closure validation before user
acknowledgement.** Read [closure-validation.md](./closure-validation.md) and
follow it; it owns the dispatch inputs, which section files to read, the
auto-bounce / surface-to-user gate, and the bound on auto-bounce rounds. The
`blocked` branch does not trigger closure validation — there is nothing finished
to validate; resolve the question and re-dispatch the implementer instead.

Self-check, on those same two branches: if your next planned action is anything
other than reading [closure-validation.md](./closure-validation.md) and
dispatching both validators, **STOP** and do that. Firing the dispatch from
memory without opening the contract loses `repo-path`, `extra-scopes`, and
`oldForms` — and a subject the detail validator never identifies produces zero
checks that read as a clean result.

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
