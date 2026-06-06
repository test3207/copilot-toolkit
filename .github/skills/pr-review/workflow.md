# PR Review Workflow

Orchestration guide for `/pr-review review pr <prId>`. Main agent follows these steps; detailed API params and templates are in [reference.md](reference.md).

## Why the new section-file model (v3.2)

Prior versions had subagents return the full analysis as the response message. The main agent then appended each response to `review.md`. When a subagent's response was large, the runtime spilled it to a `chat-session-resources/.../content.json` blob and the main agent had to `read_file` it back -- the analysis ended up in main-agent context anyway. This funneled 4 large analyses through main context and triggered early auto-compaction.

v3.2 contract:
- Each subagent **writes its full analysis directly to its own section file** under `pr-review/{prId}/sections/`.
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

1. **Local-first** - Save content locally before any remote change. Get user confirmation before remote updates.
2. **Section files are the canonical record** - Each step writes to its own section file. The final `review.md` is a concat artifact, regenerated from sections any time.
3. **Never replace full PR description** - Only add/modify specific sections when explicitly requested.
4. **No main-agent reads of `chat-session-resources/*/content.json`** - If you find yourself about to read one, STOP: it's a subagent response blob. The new contract returns small summaries; if you see a blob, the subagent violated its output contract -- log and proceed with the summary it returned, do not read the blob.

---

## Step 0: Resolve provider

Read the matched registry entry's `pr-platform` field. If missing, default to `ado` (back-compat). Read `providers/{pr-platform}.md` -- this provider file defines `getPrInfo`, `getThreads`, `fileLinkTemplate`, `autoLinkForbiddenPatterns`, and `postComment` recipes used by Steps 1, 2, 5, 7, 9.1b, and 9.2 below.

If `providers/{pr-platform}.md` does not exist, STOP and ask the user to author it per `providers/_index.md`.

## Step 1: Get PR Info

Run the **getPrInfo** recipe from `providers/{pr-platform}.md`. Extract the standard `prInfo` object (fields documented in `providers/_index.md`). Skip the review if `state` is not `active`.

## Step 2: Get Existing PR Comments

Run the **getThreads** recipe from `providers/{pr-platform}.md`. Filter out bot/system messages per the provider's filtering guidance. Note existing feedback and open issues to avoid duplicate comments.

## Step 3: Checkout PR Branch

```pwsh
git --no-pager fetch origin {sourceBranchName}
git --no-pager fetch origin {targetBranchName}
git checkout {sourceBranchName}
```

> Fetching both branches avoids the stale-diff issue (B-031): if local `origin/{targetBranchName}` is behind, the `target...HEAD` diff includes surplus context that no longer exists on the effective merge target.

## Step 4: Get Changed Files

```pwsh
git --no-pager diff --name-only origin/{targetBranchName}...HEAD
git --no-pager diff --stat origin/{targetBranchName}...HEAD
# MANDATORY: persist the full patch so Step 7 subagents can read it without re-running git diff.
# The Step 7 dispatch template references this exact path; do NOT skip this command.
New-Item -ItemType Directory -Force -Path tmp | Out-Null
git --no-pager diff origin/{targetBranchName}...HEAD > tmp/pr-{prId}-diff.txt
```

**Context budget signal**: If changed files > 30 OR diff lines > 800, set `contextPressure = high`. This signals only -- subagents in Step 7 are mandatory regardless of this flag.

## Step 5: Create section dir + header + metadata + build fileLinkTemplate

```pwsh
$prId = '{prId}'
New-Item -ItemType Directory -Force -Path "pr-review/$prId/sections" | Out-Null
# Clean any prior section files so subagent `create_file` doesn't collide
Remove-Item "pr-review/$prId/sections/*.md" -ErrorAction SilentlyContinue
```

From the provider file's `fileLinkTemplate` definition, substitute every host/registry/`prInfo`-derived placeholder (e.g. `{org}`, `{repo}`, `{prId}`, `{headSha}`) using the values from Step 1 + the matched registry entry. The result is `fileLinkTemplate` -- a string containing ONLY the per-finding placeholders `{path}`, `{startLine}`, `{endLine}`. Remember this string for Step 7 dispatch and Step 8 Action Items.

Also compute `forbiddenAutoLinkPatterns` -- the full table from the provider's `autoLinkForbiddenPatterns` section (regex pattern, what it auto-links to, and the safe replacement). Pass it as input to every Step 7 subagent dispatch so they apply the same rules.

Concrete example: see `providers/{pr-platform}.md` for substituted-template and pattern-table examples.

Write `pr-review/{prId}/sections/00-header.md`:

```markdown
# PR Review: !{prId} - {title}

| Field | Value |
| ----- | ----- |
| Title | {title} |
| Author | {author} |
| Source | `{sourceBranch}` |
| Target | `{targetBranch}` |
| Status | {status} |
| Created | {created} |
| Work Item | {wi link or "(none)"} |
| Reviewers | {list} |
| Repo | {repoNameForLinks}{optional " (`{repoGuid}`)"} |

> Drop the GUID suffix if the registry/provider does not surface one (e.g. GitHub).

## Metadata Analysis

### PR Size
- {n files} / {ins} insertions / {del} deletions
- {note on logic-only vs vendored-asset distinction if relevant}

### Template Checks (if registry has `pr-template`)
| Check | Result |
| ----- | ------ |
| Type checkbox | {ok / missing} |
| Description filled | {ok / placeholder} |
| Title clarity | {ok} |
| Single Responsibility | {ok / mixed} |
| Work item link | {ok / missing} |
| Locally tested | {ok / not stated} |
| UT covered | {ok / N/A} |
| Recording URL (if >=200 lines) | {provided / N/A / missing} |
| Feature control | {ok / bypass with reason / missing} |
```

IF registry has NO `pr-template`: skip template-specific rows. Only flag clearly empty descriptions.

## Step 6: Intent Analysis

1. Read PR description, extract purpose + linked work items
2. Identify the problem being solved and expected behavior
3. Determine **Change Type**: Config / UI / Signature / Logic / API
4. **Anti-pattern trigger scan** (lightweight, no source-file reads): from the file list + diff stats only, decide which anti-pattern group files each subagent should load:
   - `IF diff changes shared function behavior/signature/defaults OR adds field to a serialized resource model -> semantic.md`
   - `IF diff restructures control flow / adds guards / multiple params on shared component call -> control-flow.md`
   - `IF diff touches ko.computed/pureComputed/subscribe -> knockout.md`
   - `IF diff adds async ops / new enum values -> async-types.md`

Write `pr-review/{prId}/sections/10-intent.md`:

```markdown
## Intent & Approach

**Problem**: {one paragraph from PR description}

**Solution**: {numbered list of changes from author's description}

**Change Type**: {Config / UI / Signature / Logic / API}

**Anti-pattern groups dispatched to subagents**: {list}
```

**Do NOT** read source files in Step 6 to build per-caller / branch-equivalence tables. That work has moved into the subagents (they have their own context to spend on it).

---

## Step 7: Deep Analysis (Subagent Dispatch)

**MANDATORY**: Dispatch 7a/7b/7c via `runSubagent` in a single parallel tool-call block. Inline execution by the main agent is FORBIDDEN regardless of context pressure or PR size.

_Self-check before this step_: if your next planned tool call is `read_file` against a source file from the diff, STOP -- you are about to execute the analyses inline. Issue three `runSubagent` calls instead.

_Why unconditional_:
- **Context isolation** -- each subagent gets a fresh window; the main agent stays small enough to assemble Step 8.
- **Independent perspectives** -- 7a/7b/7c each load a different prompt + analysis bias; running inline collapses them into one perspective.
- **No small-PR exception** -- the cost is 3 dispatches; the benefit applies equally to small PRs.

**Shared subagent prompt template** (fill placeholders per subagent):

```text
You are {agentName}. Analyze PR !{prId} for {role}.

toolkit-root: {toolkit-root from main agent}                # workspace-relative path the skill's caller resolved (e.g. `.copilot-toolkit/.github` when consumed, `.github` when self-hosted). Substitute {toolkit-root} placeholders in your agent prompt with this value.
prId: {prId}
fileLinkTemplate: {fileLinkTemplate from Step 5}        # Template with {path}/{startLine}/{endLine} placeholders. Substitute these per finding. Do NOT construct URLs yourself.
forbiddenAutoLinkPatterns: {forbiddenAutoLinkPatterns from Step 5}   # Regex list. Never emit text that matches these; use the safe replacements shown in the table.
Intent: {one-line from Step 6}
Change Type: {Step 6}
Repo path: {registry.path}
Target branch: {targetBranch}
Changed files: see tmp/pr-{prId}-diff.txt
Anti-pattern groups to load: {list of file paths from Step 6 scan}
Repo coding-standards: {list from registry}

Output contract: WRITE full analysis to pr-review/{prId}/sections/{file}; RETURN ONLY the compact summary your agent file specifies.
```

| Subagent | role | Section file written |
| -------- | ---- | -------------------- |
| **7a: pr-logic-reviewer** | code correctness (logic, why, corners, tests) | `20-logic.md` |
| **7b: pr-impact-analyzer** | call chain + regression risk | `30-impact.md` |
| **7c: pr-quality-checker** (Haiku 4.5) | similar code + smells | `40-quality.md` |

Each subagent returns a compact summary message. Main agent collects the 3 summaries -- nothing else. No re-reading of `content.json` blobs.

### 7d: pr-finding-validator (conditional)

1. From the 3 summaries, extract Medium+ findings (severity tag >= Medium)
2. IF none: skip to Step 8
3. Dispatch **pr-finding-validator** with: `toolkit-root` from main agent, the Medium+ findings list (with the original URL links preserved), intent summary, `fileLinkTemplate + forbiddenAutoLinkPatterns` from Step 5, paths to `20-logic.md` / `30-impact.md` / `40-quality.md`
4. Validator writes `50-validation.md`; returns per-finding verdicts
5. Apply verdicts to the in-context summaries: upgrade severities where validator says so; never downgrade

---

## Step 8: Verdict + TL;DR + Action Items + Comments

The main agent operates ONLY on the compact summaries returned by 7a-7d. Do NOT `read_file` the section files in this step.

1. **Determine verdict** using [decision.md](decision.md):
   - Scan ALL findings in the summaries (apply validator severity changes)
   - If ANY finding is Bug at Medium+ with a standard-workflow repro: verdict = "Request Changes", blocking_issues >= 1
   - Never derive verdict from overall regression risk -- derive it from the highest-severity individual finding
2. **Build Action Items** locally from the summaries:
   - Apply Action Items Construction gates (G1-G4) in [decision.md](decision.md#action-items-construction-anti-padding-rule) to every candidate item; drop items that fail
   - Sort by severity: Bug > High > Medium > Low > Nit
   - Each item: checkbox + severity tag + **absolute PR file URL link** + one-line description.
   - File-reference link format (MANDATORY -- never emit relative paths like `[file.ts](repos/...)`):
     `[<repo-relative path>#L<startLine>(-L<endLine>)](<fileLinkTemplate with {path}/{startLine}/{endLine} substituted>)`
     The subagent summaries already returned links in this format -- copy them verbatim into the Action Items. Do NOT construct URLs yourself; the template comes from the provider file (see `providers/{pr-platform}.md`).
   - Zero items survive -> write `(none)`. Do NOT invent items.
3. Write `pr-review/{prId}/sections/05-tldr.md`. See [reference.md](reference.md#tldr-section-file-template) for template.
4. IF this PR fixes an ICM incident -> write `pr-review/{prId}/sections/90-icm.md` with the ICM-comment template from [reference.md](reference.md#icm-comment-section-file-template). Otherwise skip (the section won't be included in the concat).
5. Build `pr-review/{prId}/pr-comment.md` -- this is the verbatim PR-comment body. **Curated content only**: AI header + TL;DR (with Action Items) + Intent + Validation (chain per blocking item) + ICM-if-applicable + footer. Raw subagent sections (20-logic / 30-impact / 40-quality) are deliberately excluded -- every actionable finding is already in the validator-curated Action Items + Validation, and including the raw analyses would duplicate each Bug/High/Medium finding 2-3x. The full per-call-site tables / call chains / smell tables stay in `review.md` for local exploration. See [reference.md](reference.md#pr-comment-artifact-template) for the assembly recipe. Use terminal `Get-Content` concat to pull section bodies in (no `read_file`). This file lives OUTSIDE `sections/` so it does not get duplicated by the `review.md` concat in Step 9.1.
6. IF `contextPressure = high` from Step 4: append a Coverage Note inside `05-tldr.md` listing analyzed / sampled / skipped files.

---

## Step 9: Assemble review.md + Post PR Comment + Return

### 9.1 Assemble `review.md` (terminal concat -- no context load)

```pwsh
$prId = '{prId}'
# Explicit blank-line delimiter between sections. Plain Get-Content -Raw | Set-Content concatenates without a separator,
# so any section file missing a trailing newline collapses into the next heading. TrimEnd + -join '`n`n' is safe regardless.
$sections = Get-ChildItem "pr-review/$prId/sections/*.md" | Sort-Object Name
$body = ($sections | ForEach-Object { (Get-Content -Raw $_.FullName).TrimEnd("`r","`n") }) -join "`n`n"
($body + "`n") | Set-Content -Encoding UTF8 "pr-review/$prId/review.md"
```

### 9.1b File-link + auto-link sanity check (HARD GATE before posting)

```pwsh
$prId = '{prId}'
# Check 1: any markdown link whose target is not an absolute URL is a workspace-relative path -- forbidden in the posted comment.
$badLinks = Select-String -Path "pr-review/$prId/pr-comment.md" -Pattern '\]\((?!https?:|mailto:|#)' -AllMatches

# Check 2: each forbiddenAutoLinkPatterns entry from the provider (built in Step 5). Loop and abort on any match.
# The patterns + safe replacements live in providers/{pr-platform}.md; the agent runs one Select-String per row.
$violations = @()
foreach ($p in $forbiddenAutoLinkPatterns) {
    $hits = Select-String -Path "pr-review/$prId/pr-comment.md" -Pattern $p.pattern -AllMatches
    if ($hits) {
        $violations += [pscustomobject]@{ pattern = $p.pattern; autoLinksTo = $p.autoLinksTo; safe = $p.safeReplacement; hits = $hits }
    }
}

if ($badLinks) {
    Write-Error "Found workspace-relative links in pr-comment.md -- fix before posting:`n$($badLinks | Out-String)"
}
if ($violations) {
    Write-Error "Found auto-link patterns in pr-comment.md. Replace per providers/{pr-platform}.md autoLinkForbiddenPatterns:`n$($violations | ConvertTo-Json -Depth 4)"
}
if ($badLinks -or $violations) {
    # ABORT: rewrite the offending section files (see your provider's fileLinkTemplate + autoLinkForbiddenPatterns) then re-run 9.1
} else {
    Write-Host "OK: all file links absolute, no auto-link patterns."
}
```

IF either check fails -> STOP. Edit the offending section file(s) directly with `replace_string_in_file`, re-run 9.1 to rebuild review.md, then re-run 9.1b. Do NOT proceed to 9.2 with violations. For the safe replacement to use, look up the matched pattern in `providers/{pr-platform}.md` autoLinkForbiddenPatterns.

### 9.2 Post PR Comment

Run the **postComment** recipe from `providers/{pr-platform}.md`. Each provider documents its own primary path (MCP-first for providers that have an MCP server, e.g. ADO; CLI-first for providers without, e.g. GitHub `gh`) and a fallback. Use the documented fallback only if the primary fails for an auth / tenant / availability reason, or when the provider's fallback Note flags a ctx tradeoff worth taking.

### 9.3 Return to develop

```pwsh
git checkout {targetBranch}
```

> ICM Comment is NOT posted automatically. It is saved in `90-icm.md` for the user to copy-paste into ICM when the PR fixes an incident.

---

## Anti-Summarization Rule

The PR Comment body (`pr-comment.md`) MUST be assembled by concatenating the **curated** section files (TL;DR + Intent + Validation + ICM-if-applicable) via terminal, NOT rewritten by the main agent from memory. The reference template shows the exact `Get-Content` recipe.

Do NOT:

- Rewrite findings from memory or conversation context
- Condense tables in the included sections into summary counts (e.g., "3 High issues" instead of the actual 3 rows in `50-validation.md`)
- Add or drop sections relative to the reference template -- raw subagent sections (20/30/40) are intentionally excluded; do not re-add them. ICM (`90-icm.md`) is conditional on the section file existing.

**Verification before Step 9.2**: `(Get-Content "pr-review/$prId/pr-comment.md").Count` is reasonable (typically ~150-300 lines for a non-trivial PR; not 5 lines because the concat silently broke). If suspiciously short, re-run the assembly.

## Flow Summary

```text
0:   Resolve provider (registry.pr-platform -> providers/{name}.md)
1-4: PR info (provider getPrInfo) + comments (provider getThreads) + checkout + diff
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
9.2: Provider postComment (pr-comment.md body -> PR thread)
9.3: git checkout {targetBranch}
```
