# Knockout Reactivity Patterns

Patterns triggered by Knockout.js observable/computed/subscription changes.

Read [Global Detection Rules](index.md#global-detection-rules) before applying these.

---

## BAP-06: Observable Dependency Blind Spot

**Severity**: Medium
**Applies when**: A `ko.pureComputed` or `ko.computed` reads an observable inside a conditional branch

**What looks safe**: Computed returns correct value for current inputs
**What breaks**: If the branch containing the observable read doesn't execute on the first evaluation, Knockout never registers the dependency. The computed will NOT re-evaluate when that observable changes later.

**Detection**: In any computed/pureComputed, check if observable reads are inside `if`, `switch`, ternary, or short-circuit (`&&`, `||`) branches. If the branch can be skipped on first eval, the dependency may be missed.

**Example**:

```typescript
// ❌ If isAdvanced() is false on first eval, advancedSetting() is never tracked
const result = ko.pureComputed(() => {
    if (isAdvanced()) {
        return advancedSetting();  // dependency NOT registered when branch skipped
    }
    return defaultValue;
});

// ✅ Read observable unconditionally, then branch on the value
const result = ko.pureComputed(() => {
    const advanced = advancedSetting();  // always tracked
    return isAdvanced() ? advanced : defaultValue;
});
```

---

## BAP-10: Subscription Setup Order Dependency

**Severity**: Medium
**Applies when**: PR reorders event handler or `ko.subscribe()` / `ko.computed()` registrations

**What looks safe**: Same subscriptions registered, same handlers, just in different order
**What breaks**: Handler A sets state that handler B reads. Swapping registration order means B fires before A on the same notification → B reads stale state.

**Detection**: For any reordered subscription/computed setup, trace data dependencies between handlers. If handler B reads observable X that handler A writes to X, A must be registered before B.

**Example**:

```typescript
// ❌ B reads poolType before A sets it
this.hostPool.subscribe(B_handler);  // reads this.poolType()
this.hostPool.subscribe(A_handler);  // sets this.poolType()

// ✅ A fires first, B reads updated value
this.hostPool.subscribe(A_handler);  // sets this.poolType()
this.hostPool.subscribe(B_handler);  // reads this.poolType()
```

---

## BAP-11: Computed Side-Effect Timing Shift

**Severity**: Medium
**Applies when**: PR changes between `ko.computed` (eager, always evaluates) and `ko.pureComputed` (lazy, only evaluates when observed)

**What looks safe**: Same computation logic, `pureComputed` is "more efficient"
**What breaks**:

- `ko.computed`: evaluates eagerly on creation and whenever dependencies change, even if nobody reads the result. Side effects run reliably.
- `ko.pureComputed`: only evaluates when something subscribes/reads it. If nothing observes it, side effects NEVER run. Also auto-disposes when unobserved.

**Detection**: When `computed` ↔ `pureComputed` migration happens, check if the body has side effects (writes to other observables, triggers events, API calls, logging). If yes, the migration may silently break timing or skip execution entirely.

**Example**:

```typescript
// ❌ Side effect may never fire if nobody reads this computed
this.fullName = ko.pureComputed(() => {
    const name = this.firstName() + ' ' + this.lastName();
    this.analytics.track('name-computed');  // side effect -- may not run!
    return name;
});

// ✅ Use ko.computed for bodies with side effects
this.fullName = ko.computed(() => {
    const name = this.firstName() + ' ' + this.lastName();
    this.analytics.track('name-computed');  // always fires
    return name;
});
```
