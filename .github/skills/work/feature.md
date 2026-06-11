# Feature Development Workflow

```text
Understand → Analyze & Design → [Review Confirm] → Implement → Test → PR
```

**[Review Confirm]** is the key checkpoint. Implementation starts only after confirmation.

After confirmation, read `shared.md` for Implement → Test → PR steps.

---

## 1. Understand Requirements

**With tracked item**: Provider returned `{ title, body, type, parentId, comments[] }` from `getItem(id)`. Use those fields to summarize intent; confirm understanding with user.

**Without tracked item**: Clarify intent via discussion. Call provider `createItem({ type: "feature", title, body, parentId })`. If `parentId` omitted: provider uses registry `default-parent-wi` / `default-parent-issue` if set, otherwise asks the user.

---

## 2. Analyze & Design

### 2.1 Classify change type

| Type | Trigger | Analysis depth | Subagent dispatch |
| ---- | ------- | -------------- | ----------------- |
| Config / UI tweak | text / style / single-value config | Light | None — inline OK |
| Signature / shared helper | new shared function, new field on shared model | Medium | `work-architect-explorer` |
| Logic / cross-component | flag-gated branch, new flow, refactor across files | **Full** | `work-architect-explorer` **+** `work-impact-tracer` in parallel |

Record the classification before doing anything else. If unsure, escalate one level.

### 2.2 MANDATORY exploration dispatch (Medium + Full)

**Self-check**: if your next planned tool call is `edit_file`, `replace_string_in_file`,
or any write op AND `[Review Confirm]` has not been given, **STOP**. Issue a `runSubagent`
call to `work-architect-explorer` (and `work-impact-tracer` for Full) instead.

Why this rule exists: jumping to "code the obvious surface" without first mapping the
architecture is the #1 failure mode of the main agent. The subagents return DI seams,
reuse candidates, and a minimal intervention point that the main agent will not find
on its own under context pressure.

Dispatch both subagents in a **single parallel** `runSubagent` block when Full depth.
Pass to each subagent:
- Intent, repo path, tech stack
- Initial touch-point guess (if any)
- Constraints (feature gating? breaking-change policy? flight name?)
- **`toolkit-root`**: from main agent (the value substituted into `{toolkit-root}` below)
- **`anti-patterns-file`**: `{toolkit-root}/skills/work/anti-patterns/design.md`
  (subagent loads it in its own window; main agent never reads it directly)

### 2.3 Required design artifacts (output to user BEFORE `[Review Confirm]`)

After subagents return, the main agent assembles and presents these.
**No artifact = cannot leave Analyze.**

1. **Data / control flow** — text trace, each hop with `file#line`
2. **Touch-point table**

   | File | Layer | Why-here | Why-not-elsewhere |
   | ---- | ----- | -------- | ----------------- |

3. **Reuse table**

   | Existing pattern | Location | Reuse? (yes/partial/no) | How |
   | ---------------- | -------- | ----------------------- | --- |

4. **Minimal intervention point** — one paragraph: smallest change that
   satisfies intent, what was rejected, why the chosen seam beats alternatives
5. **Test cases** — happy path (required) + user-impacting error paths (required) + edge cases
6. **Code architecture** (Full only) — component structure, file organization,
   data flow between components

**Subagent-fidelity rule** (Medium + Full only): each artifact above must
either (a) cite a specific section of the subagent's return that supports it
(e.g. `architect-explorer §Touch-points row 2`), or (b) be explicitly marked
`main-agent addition: <reason>` when you add a point the subagent did not
raise. Silent divergence between subagent findings and your assembled
artifacts is the #1 way pre-confirm reviews drift back to your own codebase
guess. If you cannot cite a subagent source for a touch point, you have not
yet earned the right to assert it — re-dispatch with a narrower question, or
ask the user.

### 2.4 Confirmation

Present artifacts (2.3) + classification (2.1) to the user. **Wait for explicit user
confirmation before proceeding.**

---

## 3. Estimate & Split

- Identify impact scope (already in touch-point table)
- Estimate effort
- If large: split into sub tasks via provider `addChildren(parentId, [{ title, body }, ...])`. Provider handles native hierarchy (ADO `wit_add_child_work_items`) or substitute (GitHub task-list checkbox in parent body).

### Safe Rollout for Large / Breaking Changes

Progressive transition (use for >1 caller behavior change, schema migration,
flag-replacement, or any rollback-sensitive change):

| Phase | Action | Exit criterion |
| ----- | ------ | -------------- |
| 1. Parallel support | Keep old, add new alongside, flight controls selection | One example verified online |
| 2. Full migration | Migrate all to new, keep old as fallback | Monitor clean for N days |
| 3. Retire old | Remove old code, clean up flags | New solution stable |
