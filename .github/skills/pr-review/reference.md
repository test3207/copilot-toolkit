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

**Collapsible curated comment (since v3.6.0)**: the posted comment is one togglable block per review round. Always-visible = AI header + `## AI Code Review` title + TL;DR (verdict, metrics, validator-curated Action Items). Everything heavier — Intent, the raw subagent analyses (`20-logic` / `30-impact` / `40-quality`, **folded back in** rather than excluded), Finding Validation, and ICM — is emitted as a nested `<details>` block, collapsed by default, so the reader opens only what they need. The whole comment is wrapped in an outer `<details open>` (default-expanded; click the summary to collapse the entire round — this is what keeps a multi-round PR readable). If the assembled body would exceed the platform's comment-size cap, the assembler drops the heavy raw analyses (quality → impact → logic) first, replacing them with a one-line pointer to the local `review.md`. Pre-v3.6.0 the raw analyses were excluded outright (they duplicated each Bug/High/Medium finding 2-3x); folding + the size budget now give the detail on demand without the wall of text.

Write the review metadata to a JSON file with `create_file` (avoids shell-quoting the model name), then build the curated comment:

```sh
node .copilot-toolkit/scripts/pr-review-assemble.mjs comment --repo {repo} --pr-id {prId} \
  --meta pr-review/{repo}/{prId}/comment-meta.json
```

`comment-meta.json` = `{ "model": "<exact model name from system instructions>", "tool": "<Tool name from SKILL.md Quick Reference, default pr-review>", "version": "<Tool version, e.g. v3.6.0>", "verdict": "<optional; else parsed from 05-tldr.md's **Verdict: ...** line>", "wrap": <bool>, "collapse": [<section keys>], "sizeBudget": <int> }`. Take `wrap` / `collapse` / `sizeBudget` from the resolved provider's `commentCapabilities` section (defaults when the provider omits it: `wrap` true, `collapse` omitted = collapse every present section, `sizeBudget` 60000). The script emits the always-visible header + TL;DR, then each present section (`intent`, `logic`, `impact`, `quality`, `validation`, `icm`) as a collapsed `<details>` block, then the footer, all inside the outer `<details open>` — the raw analyses `20/30/40-*.md` are now folded in, not excluded.

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
