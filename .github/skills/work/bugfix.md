# Bug Fix Workflow

```text
Gather Info → Root Cause Analysis → [Confirm RCA] → Fix Design → [Confirm Fix] → Implement → Test → PR
```

Two confirmation points: root cause and fix design.

After fix design confirmed, read `shared.md` for Implement → Test → PR steps.

---

## 1. Gather Information

**Possible inputs**: tracked-item id / URL, text description, screenshot, repro steps, session ID, time range, plus (if the consumer wired one in) an incident-system reference.

Steps:

1. Provider `getItem(id)` if a tracked-item id is available — returns `{ title, body, type, comments[], attachments[] }`. Extract repro / symptom / scope info from those fields.
2. **Incident-source (optional)** — IF registry declares `incident-source: <path>`, load that file now and follow its instructions to fetch incident context. The file is consumer-owned; the workflow body is incident-system-agnostic.
3. Read source code — locate related code from error message / blade / component name
4. Kusto query — if time / session info available, query logs (see Templates below)
5. Local debugging — guide user to reproduce when info insufficient

---

## 2. Root Cause Analysis

### 2.1 Classify investigation depth

| Depth | Trigger | Subagent dispatch |
| ----- | ------- | ----------------- |
| Light | Single-line typo, obvious null check, error message clearly identifies the bug | None — inline OK |
| Standard | Symptom + repro but root cause not obvious from one read | `work-rca-tracer` |
| Deep | Cross-layer / data-corruption / race condition / regression of unknown origin | `work-rca-tracer` **+** `work-impact-tracer` in parallel |

When unsure, escalate one level.

### 2.2 MANDATORY tracer dispatch (Standard + Deep)

**Self-check**: if your next planned tool call is `edit_file` or any write op AND
`[Confirm RCA]` has not been given, **STOP**. Issue `runSubagent` to `work-rca-tracer`
(and `work-impact-tracer` for Deep) instead.

Why: the main agent under context pressure tends to stop at the first plausible
patch site. The tracer walks the call chain to the actual origin and ranks hypotheses
so the user confirms the real cause, not a symptom layer.

Pass to tracer:
- Symptom, repro / context, initial code pointer (if any), repo path
- **`toolkit-root`**: from main agent (the value substituted into `{toolkit-root}` below)
- **`anti-patterns-file`**: `{toolkit-root}/skills/work/anti-patterns/design.md`
  (subagent loads it in its own window; main agent never reads it directly)

### 2.3 Required RCA artifacts (output to user BEFORE `[Confirm RCA]`)

1. **Problem definition** — symptom, when it occurs, who is affected, scope
2. **Code location chain** — first frame + upward call chain, each hop with `file#line`
3. **Data flow** (if data-related) — expected vs actual at each transform
4. **Hypothesis ranking** — 2-4 candidates with evidence-for, evidence-against,
   cheapest verification
5. **Impact assessment** — affected users, severity, when introduced (if cheaply found)

### 2.4 RCA confirmation

Present artifacts (2.3) to user. **Wait for explicit confirmation of the root cause
before designing the fix.**

---

## 3. Fix Design

### 3.1 Required artifacts (output to user BEFORE `[Confirm Fix]`)

1. **Fix approach** — what changes, at which layer, why this layer (not the symptom layer)
2. **Reuse check** — is there an existing helper / pattern / DI seam that already
   handles this? Touching a smaller surface is always preferred.
3. **Regression risk table**

   | Touch | What could break | Detection | Severity |
   | ----- | ---------------- | --------- | -------- |

4. **Test cases** — verify fix works (happy path) + verify no regression + edge cases
5. **Rejected alternatives** (>=1) — what else was considered, why this approach wins

For Deep depth (cross-layer): dispatch `work-impact-tracer` if not already dispatched
in Step 2, to populate the regression table from real call-chain data.

### 3.2 Confirmation

**Wait for explicit user confirmation before implementing.**

---

## Kusto Query Templates

Resolve in this order (first hit wins):

1. **Registry `## Kusto Sources` section** (preferred, repo-scoped, multi-source supported) — pick the source matching the symptom, then load its `Query Map` file (`.github/prompts/workflows/kusto/<file>.md`). Subagent / on-demand load — does not cost main-agent ctx upfront.
2. **Registry `kusto` flat field** (legacy single-source repos) — use `db` and `filter` directly.
3. **Repo-local map** — `<repo-path>/.github/prompts/monitor-query-map.md` if the submodule maintains its own templates.

**Important: read the source's `Semantics` note before drawing conclusions.** Some sources (e.g. `synthetic-runner`) are internal probe results, NOT real user traffic — do not use their row counts to estimate user impact.
