# Harness profile: `minimal`

No model-capability scaffolding. This is the control arm: run the skill on its contract alone and measure whether the scaffolding earned its context budget.

**Nothing is loaded from this file** — it exists so `minimal` resolves to a real path and so the deliberate absence is documented rather than looking like a missing file.

## Still unconditional at this profile

The profile only removes layer-4 restatements. Everything below lives in the workflow files and holds exactly as at `strict`:

- The Step 7 subagent dispatch contract and the section-file / compact-summary model (`workflow.md`, `steps/analyze.md`) — the reasons are context isolation and independent perspectives, not model tendency.
- `pr-comment.md` is built by the `pr-review-assemble.mjs comment` recipe, and Step 9.1b's link gate must exit `0` before Step 9.2 (`steps/finalize.md`).
- The Action Items G1–G4 gates and the verdict escalation rule (`decision.md`).
- **Layer 3, never tiered**: `post-mode` defaults to `confirm`, the worktree `setup` config is read from the base checkout only, and Step 9.3 worktree cleanup runs on every exit path.

See [_index.md](./_index.md) for the layer model and profile precedence.
