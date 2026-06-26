# Semantic & Shared Function Patterns

Patterns triggered when a shared function's contract, meaning, or defaults change.

Read [Global Detection Rules](index.md#global-detection-rules) before applying these.

---

## BAP-01: Semantic Contract Violation

**Severity**: High
**Applies when**: A shared function's return value or side effects change meaning; OR a new field is added to a serialized resource model (model factory entry, property bag, schema column, REST DTO) that is round-tripped by other writers

**What looks safe**: Code correctly implements the new behavior; types unchanged
**What breaks**: Consumers assume the old semantics -- correct type, wrong meaning. A function that returned "resources in this subscription" now returns "resources across all subscriptions." Every caller compiles, but some display cross-subscription data to users who shouldn't see it. For new persistent fields, every co-writer that round-trips the resource via generic preservation will silently re-emit the new field on PATCH/PUT, often colliding with their own model fields and getting rejected by the backend.

**Detection**:
1. For each changed function, ask: "Does the output still mean the same thing to every caller?" If the meaning changes (scope, granularity, timing, freshness), check every consumer.
2. **Boundary input verification**: When code replaces calls to API_old with API_new, test behavioral equivalence at boundary inputs: null, undefined, empty string, and strings that don't match the expected format. If API_old was lenient (returns fallback for bad input) and API_new is strict (returns undefined/throws), every caller that passes non-standard input is a bug.
3. **Persistent field addition (co-writer audit)**: When the diff adds a new field to a serialized resource model, identify the resource type and search for ALL OTHER call sites that PATCH/PUT/POST it (e.g., `patchResource`, `putResource`, `createOrUpdate`). Build a **co-writer table**:

   | Co-writer | File:Line | Models new field? | Generic round-trip? | Field-name conflict? | Repro action | Risk |
   | --------- | --------- | ----------------- | ------------------- | -------------------- | ------------ | ---- |

   **Field-name conflict — check at TWO levels**:
   - **Outer**: does any co-writer's model define a field with the same name as the new field? (Usually no when the new field is brand-new.)
   - **Inner (often missed)**: if BOTH the new field AND a co-writer's modeled field are serialized strings/lists/sub-objects that encode named entries (e.g. `name:type:value` strings, comma-separated keyed lists, arrays of `{name, ...}`), check whether the same inner name can appear in both slots. Backend validators commonly reject this even though the outer DTO has no naming clash.

   **Repro action column (mandatory, not optional)**: For each co-writer flagged Medium+, write the SHORTEST user action that triggers the failure end-to-end (e.g. "V2 saves `redirectclipboard:i:1:authcontext:c4` → open Overview → Generate registration key → backend returns 400 with CustomRdpProperty conflict"). Do NOT write "smoke test that the other blade still works" — that verifies adjacent behavior, not the bug. The repro must reach the backend response or the persisted state, not just a UI render.

   If any co-writer is unaware of the new field AND uses generic preservation, flag as Bug (potential). If outer OR inner field-name conflict is possible, flag as Bug (confirmed) and severity = High — the backend will reject or the data will silently corrupt.

**Classification**: Always flag as Bug (potential), never Design Concern. Even if broadening is by-design, the reviewer cannot know if the author considered all consumers.

---

## BAP-02: Parameter Semantic Overload

**Severity**: High
**Applies when**: A PR changes behavior tied to a parameter that different callers use for different semantic intents

**What looks safe**: Parameter type unchanged, all callers compile
**What breaks**: Callers rely on different side effects of the same parameter value. A blanket behavioral change fixes one caller's intent but breaks another's.

**Detection**: Build per-caller table for the affected parameter:

| Caller | File:Line | Input Domain | Parameter Value | Semantic Intent | New Behavior Correct? |
| ------ | --------- | ------------ | --------------- | --------------- | --------------------- |

Input Domain classifies the actual values callers pass: e.g., `ARM resource ID`, `plain string`, `null/optional`, `enum value`. If callers have different input domains or different intents for the same value, any behavioral change is high-risk.

**Example**:

```typescript
// Caller A: disabled means "externally managed, don't touch state"
// Caller B: disabled means "prerequisite not met, show empty state"
// PR adds early return on disabled → Caller A fine, Caller B breaks
```

---

## BAP-08: Default Parameter Widening

**Severity**: High
**Applies when**: A function parameter's default value changes from restrictive to permissive

**What looks safe**: Function signature unchanged, all explicit callers unaffected
**What breaks**: Callers that OMIT the parameter silently get the new (wider) behavior. The diff only shows the function definition change -- no caller code changes, so it's easy to miss.

**Detection**: When a default value changes, search for ALL callers that don't pass that parameter. Each of them now gets the new default. Verify the new behavior is correct for each.

**Example**:

```typescript
// Old: callers that omit includeDeleted get false (safe)
function getResources(includeDeleted = false) { ... }

// New: callers that omit includeDeleted get true (dangerous!)
function getResources(includeDeleted = true) { ... }
// Every caller that relied on the old default now includes deleted resources
```

---

## BAP-13: Cross-Boundary Identifier Consistency

**Severity**: High
**Applies when**: The diff changes how an identifier is constructed (string concat with a prefix/suffix, an id/key/path/URL/scope builder, a serialized-config value) AND that identifier crosses a process/system boundary (passed to an external API, written into a config/property bag, used as an access **scope**, serialized for another reader)

**What looks safe**: The new construction is locally correct; types unchanged
**What breaks**: A *sibling* construction of the **same logical identifier** elsewhere (often in unchanged code) was not updated, so the two now produce different strings for what must be the same external resource. Special case -- **grant vs use**: an access grant (role assignment, ACL, key-vault policy) is scoped to identifier A while the consumer operates on identifier B; silent authorization failure.

**Detection**: When an identifier construction changes, `grep_search` for every other site that builds the same logical identifier (same helper, same prefix constant, same field name). Build a table -- include sites **outside the diff**:

| Construction site | File:Line | Produces (for the same input) | Matches the changed site? |
| ----------------- | --------- | ----------------------------- | ------------------------- |

If any access grant's scope identifier and the corresponding consumer's target identifier can differ for the same logical resource, flag as Bug (potential), severity High.

**Example**:

```text
// grant path:   scope  = `${prefix}-${region}-regional`
// consume path: target = `${prefix}-${region}`        // sibling builder, suffix missing
// -> permission granted on one resource group, operation runs on another -> authorization failure
```
