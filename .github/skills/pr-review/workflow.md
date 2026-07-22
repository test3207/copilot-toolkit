# PR Review Workflow

Orchestration guide for `/pr-review review pr <prId>`. Main agent follows these steps; detailed API params and templates are in [reference.md](reference.md).

## Why the new section-file model (v3.2)

Prior versions had subagents return the full analysis as the response message. The main agent then appended each response to `review.md`. When a subagent's response was large, the runtime spilled it to a `chat-session-resources/.../content.json` blob and the main agent had to `read_file` it back -- the analysis ended up in main-agent context anyway. This funneled 4 large analyses through main context and triggered early auto-compaction.

v3.2 contract:
- Each subagent **writes its full analysis directly to its own section file** under `pr-review/{repo}/{prId}/sections/`.
- Each subagent **returns a compact summary** (findings list + severity counts + section-file path) as its response message.
- Main agent works only from the compact summaries to decide verdict + build Action Items + TL;DR.
- `review.md` is assembled by **terminal concat** of the section files (no `read_file` of full sections by main agent during assembly).
- PR Comment body is also concat-assembled and posted via REST API in terminal (no main-agent body load).

Section files (natural sort gives final `review.md` order):

| File | Owner | When written |
| ---- | ----- | ------------ |
| `sections/00-header.md` | main agent | Step 5 |
| `sections/05-tldr.md` | main agent | Step 8 (TL;DR + Action Items) |
| `sections/10-intent.md` | main agent | Step 6 |
| `sections/20-logic.md` | pr-logic-reviewer | Step 7a |
| `sections/30-impact.md` | pr-impact-analyzer | Step 7b |
| `sections/40-quality.md` | pr-quality-checker | Step 7c |
| `sections/50-validation.md` | pr-finding-validator | Step 7d (conditional) |
| `sections/90-icm.md` | main agent | Step 8 (only if PR fixes ICM) |

Output artifacts (NOT inside `sections/`, so they don't get re-included by the concat):

| File | Owner | Purpose |
| ---- | ----- | ------- |
| `review.md` | main agent (Step 9.1) | Concat of `sections/*.md` -- canonical local record (full subagent analysis) |
| `pr-comment.md` | main agent (Step 8) | AI-header + **curated** section concat (TL;DR + Intent + Validation + ICM) + footer -- verbatim body posted to PR thread in Step 9.2. Raw subagent sections (20/30/40) are intentionally excluded -- every actionable finding is already in TL;DR Action Items and Validation, so including the raw sections triples the duplication. Dev who wants the full per-call-site / call-chain / smell tables reads the local `review.md`. |

## Rules

1. **Local-first, post-mode-gated** - Always save content locally before any remote change. Whether Step 9.2 posts the PR comment is governed by `post-mode` (resolved in Step 0): `confirm` (default) asks first, `auto` posts unattended, `skip` never posts. Worktree cleanup (Step 9.3) runs regardless.
2. **Section files are the canonical record** - Each step writes to its own section file. The final `review.md` is a concat artifact, regenerated from sections any time.
3. **Never replace full PR description** - Only add/modify specific sections when explicitly requested.
4. **No main-agent reads of `chat-session-resources/*/content.json`** - If you find yourself about to read one, STOP: it's a subagent response blob. The new contract returns small summaries; if you see a blob, the subagent violated its output contract -- log and proceed with the summary it returned, do not read the blob.

---

## Step files

Workflow is split into three step files to keep this orchestrator under budget. Read each one **only when its steps are next on the todo**:

| File | Steps | Read when |
| ---- | ----- | --------- |
| [steps/prep.md](steps/prep.md) | 0–5: resolve provider, PR info, threads, isolated worktree, diff, section dir + header | After todo list is built; before Step 0. |
| [steps/analyze.md](steps/analyze.md) | 6–7: intent + MANDATORY parallel subagent dispatch (7a/b/c) + conditional 7d validator | After Step 5 completes. |
| [steps/finalize.md](steps/finalize.md) | 8–9: verdict + Action Items + assemble + post + remove worktree | After Step 7 (or 7d) completes. |

Cross-file references: subagent prompts (in `.github/agents/pr-*.md`) call out "Step 9.1b hard gate" by name only -- they do not read the workflow files. The file-link safe-replacement table they need is in `providers/{pr-platform}.md`, not here.

---

## Anti-Summarization Rule

The PR Comment body (`pr-comment.md`) MUST be assembled by concatenating the **curated** section files (TL;DR + Intent + Validation + ICM-if-applicable) via terminal, NOT rewritten by the main agent from memory. The reference template shows the exact `Get-Content` recipe.

Do NOT:

- Rewrite findings from memory or conversation context
- Condense tables in the included sections into summary counts (e.g., "3 High issues" instead of the actual 3 rows in `50-validation.md`)
- Add or drop sections relative to the reference template -- raw subagent sections (20/30/40) are intentionally excluded; do not re-add them. ICM (`90-icm.md`) is conditional on the section file existing.

**Verification before Step 9.2**: `(Get-Content "pr-review/$repo/$prId/pr-comment.md").Count` is reasonable (typically ~150-300 lines for a non-trivial PR; not 5 lines because the concat silently broke). If suspiciously short, re-run the assembly.

## Flow Summary

```text
0:   Resolve provider (registry.pr-platform -> providers/{name}.md)
1-4: PR info (provider getPrInfo) + comments (provider getThreads) + isolated worktree + diff
  v
5:   Create sections dir + write 00-header.md (main agent)
  v
6:   Intent analysis -> write 10-intent.md + anti-pattern trigger scan (main agent, no source reads)
  v
7:   Parallel subagent dispatch (runSubagent x3)
     7a -> writes 20-logic.md, returns compact summary
     7b -> writes 30-impact.md, returns compact summary
     7c -> writes 40-quality.md, returns compact summary
  v
7d:  IF Medium+ findings: dispatch validator -> writes 50-validation.md, returns verdicts (conditional)
  v
8:   Main agent builds verdict + Action Items from SUMMARIES only
     -> writes 05-tldr.md, 90-icm.md (conditional), pr-comment.md
  v
9.1: Terminal concat sections -> review.md
9.2: Provider postComment (pr-comment.md body -> PR thread) -- gated by post-mode (confirm asks / auto posts / skip never)
9.3: git worktree remove -- unconditional finalizer (runs even if 9.2 declined/skipped/errored; user's tree was never touched)
```
