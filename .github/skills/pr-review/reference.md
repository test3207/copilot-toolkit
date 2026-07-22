# PR Review Reference

Detailed API parameters, templates, and pitfalls. Read on-demand when needed during review.

---

## Provider seam

Anything host-specific (URL formats, auto-link patterns, fetch/post recipes) lives under `providers/{pr-platform}.md`. The workflow loads the provider in Step 0 (see `providers/_index.md` for the contract). This reference file contains only host-agnostic content: section templates, decision rules, and review heuristics.

---

## Section File Templates

The workflow writes content into per-section files under `pr-review/{repo}/{prId}/sections/`. The final `review.md` is assembled by `pr-review-assemble.mjs review` (Step 9.1), which concatenates `sections/*.md` in filename order -- the numeric prefix gives natural ordering.

### TL;DR section file template

Write to `pr-review/{repo}/{prId}/sections/05-tldr.md`:

```markdown
## TL;DR

**Verdict: Approve / Approve with Comments / Request Changes**

{One paragraph: what does this PR do, is it correct, main concerns}

| Metric | Value |
| ------ | ----- |
| Risk Level | Low / Medium / High |
| Files Changed | {N} |
| Lines Changed | {ins} / {del} |
| Logic Complexity | Low / Medium / High |
| Test Coverage | OK / Gap / N/A |
| Blocking Issues | {count or 0} |

## Action Items

{count} items for author response:

- [ ] **[Bug]** `file.ts:42` -- Description. Question?
- [ ] **[High]** `file.ts:88` -- Description.
- [ ] **[Medium]** `file.ts:15` -- Description.

{If zero items survive the G1-G4 gates: write "(none)".}

{If contextPressure = high, append a "### Coverage Note" subsection listing files analyzed in depth / sampled / skipped.}
```

### Intent section file template

Already shown in `workflow.md` Step 6. Includes Problem / Solution / Change Type / Anti-pattern groups dispatched.

### ICM Comment section file template

Write to `pr-review/{repo}/{prId}/sections/90-icm.md` ONLY if the PR fixes an ICM incident:

```markdown
## ICM Comment

{Concise summary suitable for ICM incident timeline: verdict, blocking issues, regression risk. NOT posted automatically -- user copies to ICM manually.}
```

### PR Comment artifact template

Write to `pr-review/{repo}/{prId}/pr-comment.md` (NOT inside `sections/` -- lives one level up so the `review.md` concat in workflow Step 9.1 does not pull it in twice). The `pr-review-assemble.mjs comment` sub-command pulls in the section bodies -- do NOT rewrite the section content from memory.

**Curated content only (since v3.4.1)**: AI header + TL;DR (with validator-curated Action Items) + Intent + Validation (chain per blocking item) + ICM-if-applicable + footer. The raw subagent sections `20-logic.md` / `30-impact.md` / `40-quality.md` are **intentionally excluded** from the posted comment -- every actionable finding is already in TL;DR Action Items and Validation, so including the raw analyses duplicated each Bug/High/Medium finding 2-3x and pushed real comments to 80+ KB. The full per-call-site / call-chain / smell tables stay in `review.md` for local exploration; if the dev wants to debug a specific Action Item, they `cat pr-review/{repo}/{prId}/review.md` locally.

Write the review metadata to a JSON file with `create_file` (avoids shell-quoting the model name), then build the curated comment:

```sh
node .copilot-toolkit/scripts/pr-review-assemble.mjs comment --repo {repo} --pr-id {prId} \
  --meta pr-review/{repo}/{prId}/comment-meta.json
```

`comment-meta.json` = `{ "model": "<exact model name from system instructions>", "tool": "<Tool name from SKILL.md Quick Reference, default pr-review>", "version": "<Tool version, e.g. v3.5.1>" }`. The script emits header + TL;DR + Intent + Validation (if present) + ICM (if present) + footer, pulling each from `sections/`; the raw subagent sections `20/30/40-*.md` are intentionally excluded.

The PR Comment is the **validated** review -- a curated summary backed by `review.md` for deep dives. NOT a verbatim concat of all subagent output.

**Model name**: state your exact model name as defined in your system instructions. Do not guess.
**Tool name** + **Tool version**: from the Quick Reference table in [SKILL.md](./SKILL.md).

---

## Large PR Rule (>=200 lines)

If PR size >= 200 lines, check for **recording** in:

- PR description
- PR comments
- Thread replies

**Recording** = screen recording / video walkthrough explaining the changes.

| Has Recording? | Action |
| -------------- | ------ |
| Yes | Proceed with review |
| No | Request author to add recording or schedule group review |

---

## Description Update (Optional)

**Only when user requests:**

1. Read existing description (from Step 1)
2. Only ADD or MODIFY specific sections, preserve template structure
3. Save draft to `pr-review/{repo}/{prId}/updated-description.md`
4. Show diff, get user confirmation
5. Apply via the provider — use the `updateDescription` recipe from `providers/{pr-platform}.md` if it exists. If the provider does not document one, fall back to a manual paste by the user (do NOT attempt to PUT through a generic API call without provider guidance).

**Template sections to preserve:**

- Type checkboxes
- PR Author Checklist
