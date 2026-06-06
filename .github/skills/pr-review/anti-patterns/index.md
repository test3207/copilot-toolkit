# Behavioral Anti-Patterns Catalog

Subtle patterns that look correct at a glance but break under specific conditions. Split into groups by detection concern; subagents load only the groups relevant to the diff.

## Global Detection Rules

These rules apply to ALL behavioral anti-pattern checks:

1. **Simplest repro first**: Start from the initial/default state. Ask "Does this break on the very first render?" before analyzing state transitions.
2. **Severity floor**: If the simplest repro is a standard user workflow (not an edge case), severity MUST be Medium or higher, regardless of mitigating factors.
3. **Always flag, never assume intent**: Even if a behavioral change appears intentional, always classify as Bug (potential) and present the most dangerous concrete example. The reviewer cannot know if the author considered all consumers. Let the author confirm correctness.
4. **Concrete example rule**: Construct the simplest possible repro -- not the most complex edge case. If a normal user flow triggers it, that IS the example.
5. **Dead code implies lost functionality**: When dead code is found (code that can never execute), always ask: "What function was this code supposed to serve? Is anything else providing it?" If nothing provides it, escalate to Bug (potential).

## Quick Index

| ID | Pattern | Severity | Trigger | Group |
| ---- | ------- | -------- | ------- | ----- |
| BAP-01 | Semantic Contract Violation | High | Shared function's meaning changes; new field added to a serialized resource model | [semantic](semantic.md) |
| BAP-02 | Parameter Semantic Overload | High | Same parameter, different caller intents | [semantic](semantic.md) |
| BAP-03 | Refactoring Regression | High | Control flow restructured | [control-flow](control-flow.md) |
| BAP-04 | Guard Side-Effect Skip | High | Early-return guard added/modified | [control-flow](control-flow.md) |
| BAP-05 | Guard State Reachability | High | Guard fires on parameter independent from `visible` | [control-flow](control-flow.md) |
| BAP-06 | Observable Dependency Blind Spot | Medium | Observable read inside conditional branch | [knockout](knockout.md) |
| BAP-07 | Async Callback on Disposed Component | Medium | Async op added in a component | [async-types](async-types.md) |
| BAP-08 | Default Parameter Widening | High | Default value changes restrictive to permissive | [semantic](semantic.md) |
| BAP-09 | Enum/Union Exhaustiveness Gap | Medium | New enum value or union member added | [async-types](async-types.md) |
| BAP-10 | Subscription Setup Order Dependency | Medium | Subscription/handler registration reordered | [knockout](knockout.md) |
| BAP-11 | Computed Side-Effect Timing Shift | Medium | `ko.computed` to `ko.pureComputed` migration | [knockout](knockout.md) |
| BAP-12 | Dead Mechanism Substitution | High | Multiple params changed on shared component call site | [control-flow](control-flow.md) |

## Group Files

| Group | File | Patterns | Primary consumer |
| ----- | ---- | -------- | ---------------- |
| Semantic & Shared | [semantic.md](semantic.md) | BAP-01, 02, 08 | pr-impact-analyzer |
| Control Flow & Guards | [control-flow.md](control-flow.md) | BAP-03, 04, 05, 12 | pr-logic-reviewer |
| Knockout Reactivity | [knockout.md](knockout.md) | BAP-06, 10, 11 | pr-logic-reviewer |
| Async & Type Safety | [async-types.md](async-types.md) | BAP-07, 09 | both |

## Conditional Loading (Step 6)

Main agent scans diff triggers and tells subagents which group files to read:

```text
IF diff changes shared function behavior/signature/defaults OR adds field to a serialized model/DTO/resource → load semantic.md
IF diff restructures control flow / adds guards            → load control-flow.md
IF diff changes multiple params on a shared component call  → load control-flow.md
IF diff touches ko.computed/pureComputed/subscribe         → load knockout.md
IF diff adds async ops / new enum values                   → load async-types.md
```

## Adding New Patterns

1. Pick the right group file (or create a new one if no group fits and it would have 2+ patterns)
2. Add entry using the template: Severity, Applies when, What looks safe, What breaks, Detection, Example, Prior art
3. Add row to Quick Index above with the group link
4. If group file exceeds ~120 lines, split it
