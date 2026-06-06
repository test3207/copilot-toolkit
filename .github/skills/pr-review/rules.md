# PR Review Rules

Quick reference for PR review criteria, code smells, and AVD Portal-specific rules.

## PR Metadata Checklist

| Item | Rule | Action if Violated |
| ---- | ---- | ------------------ |
| PR Size | < 200 lines (excluding comments) | ⚠️ Recommend group/face-to-face review |
| PR Title | Clear, concise, describes the change | ❌ Request title update |
| PR Type | Feature / Bug Fix / Refactor / Build / Docs / Test / Other | ❌ Request type selection |
| Single Responsibility | One PR does one thing | ❌ Request PR split |
| Flighting | Required for new features or breaking changes | ⚠️ Remind to add flight |

---

## Code Smell Patterns

### 🔴 High Severity

| Smell | Description | Detection |
| ----- | ----------- | --------- |
| Duplicate Code | Same logic repeated in multiple places | grep_search for similar patterns. **Exception**: KO/React parallel implementations are expected (frameworks cannot share code). Only flag if logic is inconsistent between the two. |
| `any` Type Abuse | TypeScript `any` used without justification | grep_search `: any` |
| Missing Error Handling | try/catch missing for async operations | Check all await/Promise |
| God Component | Component doing too many things | File > 300 lines, many responsibilities |
| Semantic Contract Violation | Shared function's meaning changes, consumers assume old semantics | See [BAP-01](anti-patterns/semantic.md#bap-01-semantic-contract-violation) |
| Parameter Semantic Overload | Same parameter, different caller intents | See [BAP-02](anti-patterns/semantic.md#bap-02-parameter-semantic-overload) |
| Refactoring Regression | Control flow restructured, implicit default branch lost | See [BAP-03](anti-patterns/control-flow.md#bap-03-refactoring-regression) |
| Guard Side-Effect Skip | Early-return guard skips needed side effects | See [BAP-04](anti-patterns/control-flow.md#bap-04-guard-side-effect-skip) |
| Guard State Reachability | Guard fires on a control that becomes visible | See [BAP-05](anti-patterns/control-flow.md#bap-05-guard-state-reachability) |
| Default Parameter Widening | Default value changes restrictive → permissive | See [BAP-08](anti-patterns/semantic.md#bap-08-default-parameter-widening) |

> **Behavioral anti-patterns**: Patterns marked "See BAP-xx" have full detection guides in [anti-patterns/](anti-patterns/index.md).

### 🟡 Medium Severity

| Smell | Description | Detection |
| ----- | ----------- | --------- |
| Long Function | Function > 50 lines | Line count check |
| Deep Nesting | > 3 levels of nested if/for/while | Visual inspection |
| Magic Numbers | Hardcoded values without constants | grep_search for numeric literals |
| Props Drilling | Props passed through many levels | Check component hierarchy |

### 🟢 Low Severity

| Smell | Description | Detection |
| ----- | ----------- | --------- |
| Unused Imports | Dead imports not cleaned up | get_errors (ESLint) |
| Unused Variables | Variables declared but not used | get_errors (ESLint) |

---

## Corner Case Categories

### Null/Undefined Handling

```typescript
// ❌ Bad
const name = user.profile.name;

// ✅ Good
const name = user?.profile?.name ?? 'Unknown';
```

### Array Operations

```typescript
// ❌ Bad - may throw on empty array
const first = items[0];
const last = items[items.length - 1];

// ✅ Good
const first = items.at(0);
const last = items.at(-1);
if (items.length === 0) { /* handle empty */ }
```

### Async Operations

```typescript
// ❌ Bad - race condition, no error handling
useEffect(() => {
  fetchData().then(setData);
}, [id]);

// ✅ Good
useEffect(() => {
  let cancelled = false;
  fetchData()
    .then(result => { if (!cancelled) setData(result); })
    .catch(error => { if (!cancelled) setError(error); });
  return () => { cancelled = true; };
}, [id]);
```

### Boundary Conditions

- Min/max values
- First/last item in list
- Single item list
- Empty input
- Very long input

### Parameter Interaction

See [BAP-04](anti-patterns/control-flow.md#bap-04-guard-side-effect-skip) and [BAP-05](anti-patterns/control-flow.md#bap-05-guard-state-reachability) for full detection guides.

Quick rule: For each early-return guard, list EVERY side effect it skips. Then check ALL reachable UI states (not just init) where the guard fires on a visible control.

---

## AVD Portal Specific Rules

| Rule | Description | Action |
| ---- | ----------- | ------ |
| No console.log | Use project logging mechanisms | ❌ Remove or replace |
| No hardcoded strings | Use resource files (ClientResources.resx or *.resjson) | ❌ Move to resources |
| Accessibility | aria-label on interactive elements | ⚠️ Add if missing |
| Import Order | Don't change existing import order (MerlinBot enforces) | ⚠️ Revert changes |

### KO / React Framework Boundaries (AVD Portal only)

The portal has two coexisting frameworks: Knockout (`Client/Shared/`, `Client/<blade>/`, legacy) and React (`Client/React/`, new). Treat them as separate runtimes.

| Rule | Description | Action |
| ---- | ----------- | ------ |
| No cross-framework file sharing | Framework limitation: a `.ts` file cannot be imported by BOTH KO and React code (different build/module pipelines, different bases). "Extract a shared constant/util into a common file used by both sides" does NOT compile. | ❌ Flag any PR that imports a React-side file from KO code or vice versa. Acceptable patterns: (a) duplicate the constant on each side and add a brief comment linking the twin; (b) move the value into a runtime source both sides already consume (resource file, server-served config, ECS flag). |
| Unit tests: React required, KO not required | New / changed **React** code (`Client/React/**`) MUST include unit tests. KO code (`Client/Shared/**`, `Client/<blade>/**` except `Client/React/`) does NOT require UT — the legacy framework has no UT harness in this repo. | ❌ React change with no test → request tests. ✅ KO-only change with no test → do not flag (mention only if the author claims "tests not applicable" so the reason is recorded). For mixed PRs, scope the UT requirement to the React files only. |
| Parallel KO/React implementations | When the same feature exists in both, divergence is expected — they are independent codepaths. | Only flag if the LOGIC diverges in a user-visible way (different validation, different defaults). Pure structural difference is fine. |

---

## Review Checklist (Before Approving)

```markdown
- [ ] PR size appropriate (< 200 lines or group review scheduled)
- [ ] No high-severity code smells
- [ ] All corner cases addressed or acknowledged
- [ ] No hardcoded strings (use resource files)
- [ ] Error handling present for async operations
- [ ] Accessibility considered (aria-labels)
- [ ] No console.log statements
- [ ] Tests added/updated if applicable
```

---

## Review Decision & Action Items

See [decision.md](decision.md) -- Decision Guide, Verdict Escalation Rule, and Action Items Construction gates (G1-G4). Loaded by the main agent in workflow Step 8.
