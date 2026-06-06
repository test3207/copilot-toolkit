# Control Flow & Guard Patterns

Patterns triggered when code structure changes: refactoring, adding/modifying early-return guards.

Read [Global Detection Rules](index.md#global-detection-rules) before applying these.

---

## BAP-03: Refactoring Regression

**Severity**: High
**Applies when**: Existing control flow restructured (reordered branches, variable hoisting, combined conditions) -- not just extended with new branches

**What looks safe**: Same logic, cleaner structure, all tests pass
**What breaks**: Implicit "no branch matched → keep default" path now produces a different value because the variable initialization changed

**Detection**:

1. Enumerate ALL old branches from diff `-` lines, including implicit fall-through ("no branch matched → variable keeps initialized default")
2. Trace each branch through new code `+` lines
3. Verify identical outcomes
4. Build branch equivalence table:

| Old Branch | Input Condition | Old Outcome | New Path | New Outcome | Match? |
| ---------- | --------------- | ----------- | -------- | ----------- | ------ |

**Highest-risk pattern**: Old code initializes `result = EmptyString` and relies on fall-through to preserve it. New code initializes `result = currentValue`. No branch resets it → fall-through emits data instead of silence.

---

## BAP-04: Guard Side-Effect Skip

**Severity**: High
**Applies when**: An early-return guard is added or modified in an existing function

**What looks safe**: Guard correctly prevents an operation (e.g., fetch) when condition is met
**What breaks**: The guard also skips side effects (placeholder, items, value) that callers depend on

**Detection**: For each early-return guard, list EVERY side effect the function performs after the guard point. Verify none are needed by any caller when the guard fires.

**Example**:

```typescript
// ❌ Early return skips ALL side effects
if (disabled) { return; }  // placeholder never set

// ✅ Preserves needed side effects before returning
if (disabled) {
    control.placeholder(options.emptyPlaceholder);
    control.items([]);
    return;
}
```

---

## BAP-05: Guard State Reachability

**Severity**: High
**Applies when**: A guard/early-return fires on a parameter that can change independently from `visible`

**What looks safe**: Control starts with `visible=false`, so the guard's broken side effects are invisible
**What breaks**: A user flow makes `visible=true` while the guard still fires → user sees broken UI

**Detection**: For each caller with a dynamic guarded parameter, build a state reachability matrix:

| Caller | User Flow | visible | guarded param | Guard Fires? | Renders Correctly? |
| ------ | --------- | ------- | ------------- | ------------ | ------------------ |

Include at minimum: (a) initial state, (b) each user action that changes `visible` or the guarded parameter independently.

**Classification**:

- Guard fires on **always visible** control → Bug (confirmed)
- Guard fires on control that **becomes visible** in standard workflow → Bug (potential), Medium+
- Guard fires on **never visible** control in any reachable state → Safe

**Key rule**: "Starts visible=false" is NOT a safety guarantee. It only means the bug is invisible at init. If ANY user flow makes it visible while the guard fires, the bug is real.

---

## BAP-12: Dead Mechanism Substitution

**Severity**: High
**Applies when**: PR replaces a working parameter/mechanism with a new one, while also setting another parameter that prevents the new mechanism from executing

**What looks safe**: New code provides a replacement mechanism (e.g., callback function) for the old behavior
**What breaks**: The replacement mechanism is gated by another parameter the PR also sets, so it never runs. The old mechanism is removed. Net: functionality silently dropped.

**Detection**:

1. For each call site where the PR changes multiple parameters of a shared component, list ALL parameters changed and their old vs new values
2. For each new parameter that provides behavior (callback, filter, sort), trace into the consumer to verify it actually executes given the other parameter values
3. **Dead code reverse question**: If you find dead code (a parameter value that can never take effect), ask: "What function was this dead code supposed to serve? Is anything else providing that function now?" If nothing provides it, the functionality is dropped.
4. Compare with existing call sites of the same component (especially the canonical/original pattern) -- build a parameter comparison table:

| Parameter | Original call site | New call site (flag on) | New call site (flag off) | Consumer behavior |
| --------- | ------------------ | ----------------------- | ------------------------ | ----------------- |

**Example**:

```typescript
// OLD: location filter works via location parameter
{ location: actualLocation }  // ResourceDropDown filters by location

// NEW: author replaces location with groupByAvailability callback
{
    location: featureEnabled ? actualLocation : EmptyString,  // ← disabled
    groupingEnabled: featureEnabled,                           // ← false blocks groupByAvailability
    groupByAvailability: !featureEnabled ? matchFn : undefined // ← dead code
}
// Net: feature-off path has zero location filtering
```

