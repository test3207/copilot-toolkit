# Step 8–9: Verdict, Assemble, Post

Sourced from [workflow.md](../workflow.md). Step 8 operates only on Step 7 summaries (no `read_file` of section files). Step 9 assembles by terminal concat and posts.

## Step 8: Verdict + TL;DR + Action Items + Comments

The main agent operates ONLY on the compact summaries returned by 7a-7d. Do NOT `read_file` the section files in this step.

1. **Determine verdict** using [decision.md](../decision.md):
   - Scan ALL findings in the summaries (apply validator severity changes)
   - If ANY finding is Bug at Medium+ with a standard-workflow repro: verdict = "Request Changes", blocking_issues >= 1
   - Never derive verdict from overall regression risk -- derive it from the highest-severity individual finding
2. **Build Action Items** locally from the summaries:
   - Apply Action Items Construction gates (G1-G4) in [decision.md](../decision.md#action-items-construction-anti-padding-rule) to every candidate item; drop items that fail
   - Sort per [tags.md](../tags.md#sort-order-between-action-items): primary = Severity high→low (High > Medium > Low > Nit); secondary = within the same severity, Bug-kind first.
   - Each item: checkbox + tags in Severity → Kind → Confidence order (closed set + rendering in [tags.md](../tags.md)) + **absolute PR file URL link** + one-line description.
   - File-reference link format (MANDATORY -- never emit relative paths like `[file.ts](repos/...)`):
     `[<repo-relative path>#L<startLine>(-L<endLine>)](<fileLinkTemplate with {path}/{startLine}/{endLine} substituted>)`
     The subagent summaries already returned links in this format -- copy them verbatim into the Action Items. Do NOT construct URLs yourself; the template comes from the provider file (see `providers/{pr-platform}.md`).
   - Zero items survive -> write `(none)`. Do NOT invent items.
3. Write `pr-review/{repo}/{prId}/sections/05-tldr.md`. See [reference.md](../reference.md#tldr-section-file-template) for template.
4. IF this PR fixes an ICM incident -> write `pr-review/{repo}/{prId}/sections/90-icm.md` with the ICM-comment template from [reference.md](../reference.md#icm-comment-section-file-template). Otherwise skip (the section won't be included in the concat).
5. Build `pr-review/{repo}/{prId}/pr-comment.md` -- this is the verbatim PR-comment body, a single togglable block per review round (v3.6.0). **Always-visible**: AI header + `## AI Code Review` title + TL;DR (with Action Items). **Collapsed `<details>` (default-closed)**: Intent and Validation (chain per blocking item). The whole comment is wrapped in an outer `<details open>` (default-expanded; click the summary to collapse the entire round). The raw subagent analyses (20-logic / 30-impact / 40-quality) are NOT posted -- they duplicate the validated findings and, being pre-validation, can contradict the Validation verdicts; they stay in `review.md` for local exploration. See [reference.md](../reference.md#pr-comment-artifact-template) for the `pr-review-assemble.mjs comment` recipe + the `comment-meta.json` fields (`verdict` / `wrap` / `collapse`; the last two come from the provider's `commentCapabilities`). This file lives OUTSIDE `sections/` so it does not get duplicated by the `review.md` concat in Step 9.1.
6. IF `contextPressure = high` from Step 4: append a Coverage Note inside `05-tldr.md` listing analyzed / sampled / skipped files.

---

## Step 9: Assemble review.md + Post PR Comment + Return

### 9.1 Assemble `review.md` (terminal concat -- no context load)

```sh
node .copilot-toolkit/scripts/pr-review-assemble.mjs review --repo {repo} --pr-id {prId}
```

Concatenates `sections/*.md` (filename order) into `review.md` with an explicit blank-line delimiter, so a section missing a trailing newline never collapses into the next heading.

### 9.1b File-link + auto-link sanity check (HARD GATE before posting)

Write the provider's `forbiddenAutoLinkPatterns` (built in Step 5) to a JSON file with `create_file`, then run the gate:

```sh
node .copilot-toolkit/scripts/pr-review-assemble.mjs lint --repo {repo} --pr-id {prId} \
  --patterns pr-review/{repo}/{prId}/link-patterns.json
```

`link-patterns.json` is a JSON array `[{ "pattern", "autoLinksTo", "safeReplacement" }, ...]` copied from the provider's `autoLinkForbiddenPatterns` table (omit `--patterns` only if the provider defines none). The gate checks (1) any markdown link whose target is not an absolute URL / anchor (workspace-relative -- forbidden), and (2) each provider pattern.

Exit `0` = clean, proceed. Exit `3` = the JSON stdout lists `relativeLinks` and `autoLinks` (each with line numbers + the safe replacement) -> STOP: edit the offending section file(s) with `replace_string_in_file`, re-run 9.1 to rebuild `review.md`, then re-run 9.1b. Do NOT proceed to 9.2 with violations.

### 9.2 Post PR Comment (gated by `post-mode` from Step 0)

Branch on `postMode`:

- **`confirm`** (default): show the verdict, Action-Item count, and the local `pr-comment.md` path, then ask the user to confirm. On **yes**, run the `postComment` recipe below; on **no**, skip posting (keep the local artifacts) and continue to 9.3.
- **`auto`**: run `postComment` immediately, no prompt (full hands-off).
- **`skip`**: do NOT post; report the local `pr-comment.md` path and continue to 9.3.

When posting, run the **postComment** recipe for the access method resolved in Step 0 (from `providers/{pr-platform}.md`):

- `mcp` / `cli` / `rest`: post via that method's recipe. For `mcp`, fall through to the REST recipe only if the call fails for an auth / tenant / availability reason, or when the provider's Note flags a ctx tradeoff worth taking.

### 9.3 Remove the isolated worktree (unconditional finalizer)

Runs on EVERY exit of Step 9.2 -- post succeeded, was declined (`confirm` -> no), skipped (`skip`), or errored. The review never touched the user's working tree, so there's nothing to restore -- just delete the per-review worktree. The same script that built it tears it down (idempotent: a partially failed run may have already removed it):

```sh
node .copilot-toolkit/scripts/pr-review-worktree.mjs cleanup \
  --repo-path {repoContext.path} --repo {repo} --pr-id {prId}
```

Read the JSON output. If `removed` is `false`, surface a non-blocking warning to the user: the worktree directories in `leaked[].path` are still held by an editor or language service and are hidden from git/search (`orphansHidden` confirms how many are denylisted); restart the editor to free handles so a later setup can reclaim the path. The output `*.md` files under `pr-review/{repo}/{prId}` live in the separate self-ignored tree and stay.

> ICM Comment is NOT posted automatically. It is saved in `90-icm.md` for the user to copy-paste into ICM when the PR fixes an incident.
