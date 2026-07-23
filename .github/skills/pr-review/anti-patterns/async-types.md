# Async & Type Safety Patterns

General TypeScript/JavaScript patterns for async lifecycle and type system gaps.

Read [Global Detection Rules](index.md#global-detection-rules) before applying these.

---

## BAP-07: Async Callback on Disposed Component

**Severity**: Medium
**Applies when**: PR adds or modifies async operations (fetch, setTimeout, Promise chain) in a component

**What looks safe**: Async operation has proper error handling and completes correctly
**What breaks**: Component is disposed (user navigated away) before the callback fires. Callback writes to a disposed observable → silent error, memory leak, or stale UI update on a view that no longer exists.

**Detection**: For each async callback, check:

1. Is there a disposal guard (`if (!this.isDisposed())`)?
2. Does the component's `dispose()` cancel or ignore pending operations?
3. For `setTimeout`/`setInterval`: is the handle cleared on dispose?

**Example**:

```typescript
// Bad: No disposal guard
fetchData().then(data => {
    this.items(data);  // observable may be disposed
});

// Good: With disposal guard
fetchData().then(data => {
    if (!this.isDisposed()) {
        this.items(data);
    }
});
```

---

## BAP-09: Enum/Union Exhaustiveness Gap

**Severity**: Medium
**Applies when**: PR adds a new enum value or union type member

**What looks safe**: TypeScript compiles, new value handled where it was added
**What breaks**: Existing `switch` or `if-else` chains elsewhere don't handle the new value. Falls through to `default` which may produce wrong behavior. TypeScript only catches this if the switch has NO default clause.

**Detection**: For each new enum/union member, search for ALL `switch`/`if-else` chains on that type across the codebase. Verify each handles the new value correctly (or that the `default` clause produces correct behavior for it).

**Example**:

```typescript
enum HostType { Personal, Pooled, PooledElastic }  // PooledElastic is new

// Bad: Existing switch elsewhere -- PooledElastic falls to default
switch (hostType) {
    case HostType.Personal: return personalConfig;
    case HostType.Pooled: return pooledConfig;
    default: return pooledConfig;  // Is this correct for PooledElastic?
}
```
