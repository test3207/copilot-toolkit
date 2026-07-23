# PR Review Action-Item Tag Taxonomy

Single source of truth for the tags `pr-review` puts on author-facing Action
Items. Every producer (the four `pr-*` subagents) and consumer
([steps/finalize.md](steps/finalize.md), [steps/analyze.md](steps/analyze.md),
[decision.md](decision.md), [reference.md](reference.md), [rules.md](rules.md))
references THIS file — none re-lists the set.

Subagent-loadable / on-demand (no strict size budget). Subagents do not read
the whole file at runtime — they carry the one-line allowlist inlined in their
output-format section and point here for meaning.

## Model: one Action Item carries tags from three orthogonal dimensions

| Dimension | Required? | Count | Closed set (ordered) |
| --------- | --------- | ----- | -------------------- |
| **Severity** | required | exactly 1 | `High` > `Medium` > `Low` > `Nit` |
| **Kind** | optional | 0..N (usually 1) | `Bug` · `Style` · `Perf` · `Security` · `Test` · `Docs` · `A11y` |
| **Confidence** | optional | 0..1 | `needs-confirm` |

No tag outside these three sets may appear on an author-facing Action Item.
`[Suggestion]`, `[warn]`, `[Question]`, or any ad-hoc bracket tag are FORBIDDEN.

### Severity (axis-1) — "how much should I care"

- `High` — serious; fix before merge.
- `Medium` — should fix; non-trivial impact.
- `Low` — minor; fix if convenient.
- `Nit` — optional / pedantic; author may ignore.

Maps from the internal `High` / `Medium` / `Low` smell tiers in
[rules.md](rules.md) and the `**Severity**:` labels in
[anti-patterns/](anti-patterns/index.md). Those heading / label forms are
INTERNAL axis-1 tiers; the bracket tag here is the author-facing form.

### Kind (axis-2) — "what kind of problem"

- `Bug` — a functional defect: wrong behavior, regression, or violated
  invariant. Special: drives the verdict (see Verdict mapping).
- `Style` — readability, naming, formatting, idiom.
- `Perf` — performance / resource cost.
- `Security` — security / input-trust / secret handling.
- `Test` — missing or weak test coverage.
- `Docs` — comments / documentation.
- `A11y` — accessibility (aria, keyboard, contrast).

Kind is optional. A finding may carry more than one Kind when it genuinely
spans categories (e.g. `[Bug]` + `[Security]`), but prefer the single most
relevant one.

### Confidence (axis-3) — "how sure are we"

- `needs-confirm` — the finding rests on an irreducibly-uncertain precondition
  (runtime-only data, external-system behavior, or product / UX intent not in
  the repo) that the human / author must confirm. Emitted when the
  `pr-finding-validator` returns `unverifiable`. Default (no tag) = validated /
  normal confidence.

## Tag order WITHIN one Action Item

Fixed order so the list scans uniformly: **Severity → Kind → Confidence**.

```text
**[Severity]** **[Kind...]** **[Confidence...]**
```

Examples:

```text
- [ ] **[High]** **[Bug]** `file.ts:42` — description
- [ ] **[Medium]** **[Bug]** **[needs-confirm]** `file.ts:88` — description
- [ ] **[Low]** **[Style]** `file.ts:10` — description
- [ ] **[Medium]** `file.ts:15` — description        (severity only)
```

## Sort order BETWEEN Action Items

1. Primary: Severity, high → low (`High` > `Medium` > `Low` > `Nit`).
2. Secondary: within the same Severity, an item whose Kind contains `Bug`
   sorts first.

## Verdict mapping (consumed by decision.md / finalize.md)

A finding forces **Request Changes** when ALL hold:

- Kind contains `Bug`, AND
- Severity ≥ Medium, AND
- simplest repro is a standard user workflow (not an edge case), AND
- it is not demoted by Confidence `needs-confirm` or a validator `refuted`.

Otherwise the finding is non-blocking (Approve / Approve with Comments per
[decision.md](decision.md)).

## Validator verdict → tag effect (from pr-finding-validator)

| Validator verdict | Effect on the Action Item tags |
| ----------------- | ------------------------------ |
| `confirmed` | keep tags as-is |
| `upgraded` | recompute Severity / Kind at the higher level the validator sets |
| `theoretical` | keep tags; note "triggerable only via unusual input" in the description (no tag change) |
| `refuted` | drop from Action Items, or demote to `[Nit]`; state the resolving fact |
| `unverifiable` | add Confidence `[needs-confirm]`; keep Severity / Kind |

## Rendering rules

- Author-facing Action Items: bold bracket form `**[Tag]**`, in the
  within-item order above. This is the ONLY author-facing tag form.
- The `High` / `Medium` / `Low` severity headings and `**Severity**:` labels
  are INTERNAL axis-1 tiers (analysis / anti-pattern files) that MAP to the
  Severity tag — not author-facing tags themselves.
- `[ok]` / `[issue]` / `[warn]` are INTERNAL section-analysis markers used
  inside `sections/20-logic.md` etc. They render in `review.md` but are NEVER
  Action-Item tags.
- Per-subagent `Counts:` / `Smell counts:` lines are INTERNAL informational
  metrics, not author-facing tags. Report them per dimension (Severity tiers,
  and any Kind counts separately) -- never merge a Kind (e.g. `Bug`) into the
  Severity tier list.

## Allowlist (hard rule)

Producers (the four `pr-*` subagents) and the main agent MUST emit only tags
from the three closed sets above on findings / Action Items. Any other bracket
tag is a taxonomy violation.
