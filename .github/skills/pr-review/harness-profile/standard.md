# Harness profile: `standard`

Clusters **A** (dispatch) and **B** (artifacts from files) only. Drops the anti-padding restatement and the forced todo list — use this when the model plans reliably on its own but still benefits from the architecture contract being restated at the point of use.

Nothing here introduces new workflow behavior. See [_index.md](./_index.md) for the layer model and profile precedence.

## A. Dispatch is not optional (Step 7)

- Inline execution of 7a/7b/7c by the main agent is **FORBIDDEN regardless of context pressure or PR size**. `contextPressure = high` from Step 4 is a signal for the Coverage Note only; it never converts a dispatch into an inline read.
- _Self-check before Step 7_: if your next planned tool call is `read_file` against a source file from the diff, **STOP** — you are about to execute the analyses inline. Issue three `runSubagent` calls instead.

## B. Artifacts come from files, never from memory (Steps 8–9)

- Do **not** rewrite findings from memory or conversation context, and do not condense the included sections into summary counts. `pr-comment.md` is produced by the `pr-review-assemble.mjs comment` recipe; section bodies come from the section files.

## Not loaded at this profile

- **C. Anti-padding** — the G1–G4 gates in `decision.md` remain in force; only the "do not invent items to look thorough" restatement is dropped.
- **D. Todo-driven execution** — the step order in `workflow.md` → *Flow Summary* still defines the run; only the mandatory `manage_todo_list` scaffold is dropped.
