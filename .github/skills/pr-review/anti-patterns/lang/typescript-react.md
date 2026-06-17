# TypeScript / React language pack

Anti-patterns specific to TypeScript / React / Knockout repositories. This is a **language pack**: it loads only when the diff is detected as TypeScript/React (see [index.md → Language Packs](../index.md#language-packs)). On C#/Python/other repos it no-ops.

Read [Global Detection Rules](../index.md#global-detection-rules) before applying these.

The Knockout reactivity patterns (BAP-06/10/11) trigger only on `ko.computed` / `ko.pureComputed` / `ko.subscribe` usage; skip them for React-only or non-KO TypeScript repos.

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

---

## TSR-01: Cross-Framework File Sharing

**Severity**: High
**Applies when**: The repo runs both Knockout (legacy) and React (new) as separate runtimes, and a PR imports a file across the boundary.

**What looks safe**: "Extract a shared constant/util into a common `.ts` file used by both KO and React code."
**What breaks**: A single `.ts` file cannot be imported by BOTH KO and React code — different build/module pipelines and module bases mean the shared import does not compile.

**Detection**: Flag any PR that imports a React-side file from KO code or vice versa.

**Acceptable patterns**: (a) duplicate the constant on each side with a brief comment linking the twin; (b) move the value into a runtime source both sides already consume (resource file, server-served config, feature flag).

---

## TSR-02: React Unit-Test Gap (KO exempt)

**Severity**: Medium
**Applies when**: A PR adds/changes React code in a repo that also carries a legacy KO framework with no UT harness.

**What looks safe**: New code with no tests, "matching the legacy KO code's no-test convention."
**What breaks**: React code is testable and expected to ship tests; silently skipping them erodes coverage on the new framework.

**Detection**: New / changed **React** files (the repo's React root, e.g. `Client/React/**`) MUST include unit tests. KO-only changes (legacy paths) do NOT require UT. For mixed PRs, scope the UT requirement to the React files only.

**Action**: React change with no test → request tests. KO-only change with no test → do not flag (note only if the author claims "tests N/A" so the reason is recorded).

---

## TSR-03: Parallel KO/React Divergence

**Severity**: Medium
**Applies when**: The same feature exists in both KO and React and a PR changes one side.

**What looks safe**: Divergence between the two implementations.
**What breaks**: They are independent codepaths; structural difference is expected, but a **logic** divergence (different validation, different defaults) is a user-visible bug.

**Detection**: Only flag if the LOGIC diverges in a user-visible way. Pure structural difference is fine. Do NOT raise DRY/duplicate-code findings across the KO↔React boundary — code cannot be shared.
