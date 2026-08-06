# Harness profiles

Model-capability scaffolding for the pr-review skill, kept **separate from the workflow itself** so it can be reduced or removed without touching the parts that never depreciate.

## Why this folder exists

Four kinds of content live in a prose harness, and they age at completely different rates:

| Layer | Depreciates? | Lives in |
| ----- | ------------ | -------- |
| 1. Our-world facts (formats, provider recipes, tag taxonomy, output paths) | Never — no model can infer them | `providers/*.md`, `tags.md`, `rules.md`, `anti-patterns/*` |
| 2. Resource constraints (context budget, cost, latency) | Never fully | `workflow.md` section-file model, subagent context isolation |
| 3. Safety / authority | Never, and must not be model-dependent | `post-mode` gating, base-checkout worktree config read, Step 9.3 cleanup |
| 4. Model-capability compensation | Fast, and model-**specific** | **this folder** |

**Classification test** — does the rule constrain a property of the **output**, or a property of the **agent's own process**? Output → layer 1/2/3, stays in the workflow files, unconditional. Process / tendency → layer 4, belongs here.

Layer 4 was grown by patching observed failures of one model family in place. On another model half of it may be inert, and inert constraints are not free: they spend context budget and instruction-following capacity that would otherwise go to the diff. Tiering makes "does this scaffolding help or hurt model X" a single-flag A/B experiment.

## Profiles

| Profile | Loads | Use when |
| ------- | ----- | -------- |
| [`strict.md`](./strict.md) (default) | All four clusters — dispatch, assembly, padding, todo tracking | Default. Matches the behavior this skill was tuned for; change nothing until you have a baseline. |
| [`standard.md`](./standard.md) | Dispatch + assembly guards only | The model plans reliably on its own but still benefits from the architecture contract being restated. |
| [`minimal.md`](./minimal.md) | Nothing | Measuring whether the scaffolding helps at all, or running a model whose context is better spent on the diff. |

Resolution (identical precedence shape to `post-mode`, same script, same call):

```text
CLI --harness-profile <p>  >  .github/pr-review.local/config.json "harness-profile"  >  strict
```

Step 0 resolves it via `scripts/pr-review-config.mjs resolve` (which returns `harnessProfile` alongside `postMode`) and the main agent reads the matching file once, right after `workflow.md`.

## Rules for this folder

1. **Layer 3 is never tiered.** No profile may weaken the `post-mode` default, the base-checkout `worktree` config read (anti-injection), or the unconditional Step 9.3 worktree cleanup. Those live in the workflow files and hold at `minimal` exactly as at `strict`.
2. **A profile only ever removes.** Profiles carry no unique instructions — every line in one restates or self-checks a rule that already exists in `workflow.md` / `steps/*.md` / `decision.md`. A run at `minimal` is still a valid run.
3. **New scaffolding lands here, not in the step files.** When a run fails because the agent drifted from its own process (skipped a step, inlined subagent work, rewrote an artifact from memory), the fix is a cluster entry here — not another restatement in a third step file. Restatement across files is the fingerprint of an untiered harness.
4. **`tags.md` is out of scope.** The taxonomy is layer 1 and downstream consumers key accumulated review statistics on it; no profile touches it.
