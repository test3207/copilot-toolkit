# Harness profile: `strict` (default)

All four model-capability clusters. This is the behavior the skill was tuned for — every statement below was previously inlined in `SKILL.md` / `workflow.md` / `steps/*.md` / `decision.md`.

Nothing here introduces new workflow behavior: each cluster restates or self-checks a rule that already exists in those files. See [_index.md](./_index.md) for the layer model and profile precedence.

## A. Dispatch is not optional (Step 7)

- Inline execution of 7a/7b/7c by the main agent is **FORBIDDEN regardless of context pressure or PR size**. `contextPressure = high` from Step 4 is a signal for the Coverage Note only; it never converts a dispatch into an inline read.
- **No small-PR exception** — the cost is 3 dispatches; the benefit applies equally to small PRs.
- _Self-check before Step 7_: if your next planned tool call is `read_file` against a source file from the diff, **STOP** — you are about to execute the analyses inline. Issue three `runSubagent` calls instead.
- _Self-check on subagent return_: if you are about to `read_file` a `chat-session-resources/*/content.json` blob, **STOP** — that is a subagent response blob. The contract returns small summaries; log the violation and proceed with the returned summary.

## B. Artifacts come from files, never from memory (Steps 8–9)

- Do **not** rewrite findings from memory or conversation context. `pr-comment.md` is produced by the `pr-review-assemble.mjs comment` recipe; section bodies come from the section files.
- Do **not** condense tables in the included sections into summary counts (e.g. "3 High issues" instead of the actual 3 rows in `50-validation.md`).
- Post the **full** assembled body — do not re-summarize it on the way to Step 9.2.

## C. An empty Action Items list is a correct outcome (Step 8)

- Do **not** invent items to look thorough. The G1–G4 gates in `decision.md` are the filter; when zero candidates survive, `(none)` is the right answer, not a prompt to find something.

## D. Todo-driven execution

**BEFORE any review action, create a todo list using `manage_todo_list`.**

```text
1. Read workflow.md to get the orchestrator + step file index.
2. Create todo list with ALL steps 0-9 from the Flow Summary (one todo per step / sub-step).
3. Before each step's todo, read the matching step file (steps/prep.md / steps/analyze.md / steps/finalize.md) if not yet loaded.
4. Execute steps ONE BY ONE, marking progress.
5. Never skip steps or execute without todo tracking.
```
