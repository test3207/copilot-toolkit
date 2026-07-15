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
   - Sort by severity: Bug > High > Medium > Low > Nit
   - Each item: checkbox + severity tag + **absolute PR file URL link** + one-line description.
   - File-reference link format (MANDATORY -- never emit relative paths like `[file.ts](repos/...)`):
     `[<repo-relative path>#L<startLine>(-L<endLine>)](<fileLinkTemplate with {path}/{startLine}/{endLine} substituted>)`
     The subagent summaries already returned links in this format -- copy them verbatim into the Action Items. Do NOT construct URLs yourself; the template comes from the provider file (see `providers/{pr-platform}.md`).
   - Zero items survive -> write `(none)`. Do NOT invent items.
3. Write `pr-review/{repo}/{prId}/sections/05-tldr.md`. See [reference.md](../reference.md#tldr-section-file-template) for template.
4. IF this PR fixes an ICM incident -> write `pr-review/{repo}/{prId}/sections/90-icm.md` with the ICM-comment template from [reference.md](../reference.md#icm-comment-section-file-template). Otherwise skip (the section won't be included in the concat).
5. Build `pr-review/{repo}/{prId}/pr-comment.md` -- this is the verbatim PR-comment body. **Curated content only**: AI header + TL;DR (with Action Items) + Intent + Validation (chain per blocking item) + ICM-if-applicable + footer. Raw subagent sections (20-logic / 30-impact / 40-quality) are deliberately excluded -- every actionable finding is already in the validator-curated Action Items + Validation, and including the raw analyses would duplicate each Bug/High/Medium finding 2-3x. The full per-call-site tables / call chains / smell tables stay in `review.md` for local exploration. See [reference.md](../reference.md#pr-comment-artifact-template) for the assembly recipe. Use terminal `Get-Content` concat to pull section bodies in (no `read_file`). This file lives OUTSIDE `sections/` so it does not get duplicated by the `review.md` concat in Step 9.1.
6. IF `contextPressure = high` from Step 4: append a Coverage Note inside `05-tldr.md` listing analyzed / sampled / skipped files.

---

## Step 9: Assemble review.md + Post PR Comment + Return

### 9.1 Assemble `review.md` (terminal concat -- no context load)

```pwsh
$prId = '{prId}'
$repo = '{repo}'
# Explicit blank-line delimiter between sections. Plain Get-Content -Raw | Set-Content concatenates without a separator,
# so any section file missing a trailing newline collapses into the next heading. TrimEnd + -join '`n`n' is safe regardless.
$sections = Get-ChildItem "pr-review/$repo/$prId/sections/*.md" | Sort-Object Name
$body = ($sections | ForEach-Object { (Get-Content -Raw $_.FullName).TrimEnd("`r","`n") }) -join "`n`n"
($body + "`n") | Set-Content -Encoding UTF8 "pr-review/$repo/$prId/review.md"
```

### 9.1b File-link + auto-link sanity check (HARD GATE before posting)

```pwsh
$prId = '{prId}'
$repo = '{repo}'
# Check 1: any markdown link whose target is not an absolute URL is a workspace-relative path -- forbidden in the posted comment.
$badLinks = Select-String -Path "pr-review/$repo/$prId/pr-comment.md" -Pattern '\]\((?!https?:|mailto:|#)' -AllMatches

# Check 2: each forbiddenAutoLinkPatterns entry from the provider (built in Step 5). Loop and abort on any match.
# The patterns + safe replacements live in providers/{pr-platform}.md; the agent runs one Select-String per row.
$violations = @()
foreach ($p in $forbiddenAutoLinkPatterns) {
    $hits = Select-String -Path "pr-review/$repo/$prId/pr-comment.md" -Pattern $p.pattern -AllMatches
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

Run the **postComment** recipe for the access method resolved in Step 0 (from `providers/{pr-platform}.md`):

- `mcp` / `cli` / `rest`: post via that method's recipe. For `mcp`, fall through to the REST recipe only if the call fails for an auth / tenant / availability reason, or when the provider's Note flags a ctx tradeoff worth taking.

### 9.3 Remove the isolated worktree

The review never touched the user's working tree, so there's nothing to restore -- just delete the per-review worktree (the output `*.md` files live one level up and stay).

```pwsh
$prId = '{prId}'
$repo = '{repo}'
git worktree remove --force "pr-review/$repo/$prId/worktree"
git worktree prune
```

> ICM Comment is NOT posted automatically. It is saved in `90-icm.md` for the user to copy-paste into ICM when the PR fixes an incident.
