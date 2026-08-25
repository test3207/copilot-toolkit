# Context Engineering

Design files around how agents consume them — not just how humans organize them. Every file in this workspace may be loaded into an agent's context window. Size, structure, and growth trajectory all matter.

## File Size Budgets

| File type | Max lines | Rationale |
| --- | --- | --- |
| Prompt file (`.prompt.md`) | ~80 | Loaded permanently into session context |
| Agent file (`.github/agents/`) | ~100 | Loaded permanently when subagent is invoked |
| On-demand doc (`docs/tools/`) | ~150 | Read by main agent; competes with other context |
| On-demand reference (workflow files) | ~120 | Read by subagents with smaller effective context |

**YAML frontmatter** (between `---` delimiters) is excluded from line counts — it is metadata consumed by the runtime, not context content.

When a file exceeds its budget: split into a directory + `index.md`.

## Changelog Management

Changelog sections grow without bound. To keep doc files within budget:

- **Doc keeps latest version marker only**: `Latest: **X.Y** (date)` + bullet summary of that version's changes.
- **Full history** lives in git (`git log -p -- <file>`). Review step 5 (dedup) uses `git log`, not the doc.
- **Entry format**: concise bullets (~5 lines max per version).

## Extensibility Assessment

Before creating any knowledge file (catalogs, rule sets, pattern collections), answer:

1. **Will this content grow?** If yes, how fast? (one-off vs. open-ended)
2. **Growth pattern?** Additive entries (catalog) vs. deepening (tutorial)
3. **Threshold?** At ~5 entries or ~80 lines, switch to directory + index
4. **Access pattern?** Will consumers need all items or only a subset?

Decision table:

| Growth | Access pattern | Starting structure |
| --- | --- | --- |
| Fixed / slow | Read all | Single file |
| Open-ended | Read all | Single file → split when budget exceeded |
| Open-ended | Read subset | Directory + index from the start |

## Chunk by Access Pattern

Content read together should be in the same file. Content read conditionally should be in separate files.

- **Same file**: steps that always execute together, rules that always apply
- **Separate files**: category-specific rules, optional reference tables, examples

## Subagent Context Budget

See [subagent-design.md](./subagent-design.md) for subagent-specific budgets (context input, return size, reference manifest).

## Single-Sourcing Check

Before writing **or changing** a statement of a fact (a rule, a threshold, an enumeration, a predicate, a path list), grep for it.

- **It is already stated elsewhere and this edit changes one copy** → update every copy in this same edit, or collapse the rest into pointers. A partial update is the defect this check exists to prevent, and it is the shape every recorded instance has taken.
- **Another file already states it and this site does not yet** → write a pointer to that site, not a second copy.
- **It genuinely must be restated here** → say why, inline at the restating site, in the same edit.

Deciding question: *can the reader at this site follow a pointer?* If yes, the pointer is the answer.
A restatement with no recorded reason is a defect — the copies drift apart and neither announces which one is canonical.

## Restructure Verification Checklist

When splitting or reorganizing files:

1. **Inventory** — list all existing files affected by the change
2. **Create** — write new files with deduplicated content
3. **Slim** — remove migrated content from old files, replace with references
4. **References** — verify all cross-file links resolve (no broken paths)
5. **Dedup** — apply the Single-Sourcing Check above to every fact the restructure moved
6. **Budget check** — verify all files stay within size budgets above

## Reference Loading Rules

References (`read file X`) load entire files into context. Design them carefully.

### Rules

1. **Inline ≤10 lines** — if the referenced content is a small table or a few rules, inline it in the prompt. Don't create a file read for 5 lines.
2. **Step-scoped loading** — load a reference at the step that needs it, not upfront. Write `Step N: read X` instead of `Read X first`.
3. **Conditional loading** — references that only apply to certain paths use `IF <condition> → read <file>`. E.g., `IF creating catalog → read context-engineering.md`.
4. **No circular references** — if A references B, B must NOT reference A (directly or transitively). Before adding a reference, trace the full chain and verify no cycles.
5. **Max depth = 5** — reference chains (A→B→C→...) may go up to 5 levels deep. Beyond that, flatten the structure. At each level, prefer conditional loading to limit actual reads.
6. **Reference budget per path** — calculate total lines for each workflow path (prompt base + all reads across all depths). Target: main agent path < 250 lines total, subagent path < 200 lines. Complex multi-step workflows with conditional references may exceed 250 if loads are step-scoped (not all read simultaneously); document actual budget in the tool's context table.
7. **Link visibility = read intent** — agents treat visible `[links](path)` and file names as implicit read targets. If a file is owned by a subagent, do NOT link or name it in the orchestrator prompt. Mention subagent-owned files only in the subagent's own agent file or workflow.

### Applying to Prompts

Instead of:

```text
## Reference
- Read `standards.md` (read this first)
- Read `context.md`
- Read `agents.md`
```

Use:

```text
## Rules
- [inline the 3 most critical rules here]

## Steps
1. Step one...
2. IF creating knowledge file → read `context-engineering.md`
3. IF designing subagents → read `subagent-design.md`
```

### Orchestrator + Subagent Isolation

When a prompt delegates work to subagents:

```text
# BAD — orchestrator will read all linked files before invoking subagent
## Workflow Files
| Command | Files |
| check   | Subagent reads [gather.md](gather.md); Orchestrator reads [analyze.md](analyze.md) |
| Ref     | [patterns.md](patterns.md), [query-map.md](query-map.md) |

# GOOD — orchestrator only sees its own files
## Workflow Files (orchestrator only)
| Command | File |
| check   | [analyze.md](analyze.md) (after subagent returns) |

DO NOT read gather.md, patterns.md, or query-map.md. The subagent handles its own files.
```

Principle: the orchestrator prompt must contain **zero links and zero file names** for subagent-owned resources. Even mentioning them in a "don't read" table row with a link causes agents to read them.
