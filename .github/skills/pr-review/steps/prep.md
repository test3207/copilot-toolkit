# Step 0–5: Setup, Fetch, Section Scaffolding

Sourced from [workflow.md](../workflow.md). Main agent runs these sequentially.

## Step 0: Resolve provider

Read `repoContext.pr-platform` (from the matched registry entry in registry mode, or the derived value in derive mode). If missing, default to `ado` (back-compat). Read `providers/{pr-platform}.md` -- this provider file defines `getPrInfo`, `getThreads`, `fileLinkTemplate`, `autoLinkForbiddenPatterns`, and `postComment` recipes used by Steps 1, 2, 5, 7, 9.1b, and 9.2 below.

If `providers/{pr-platform}.md` does not exist, STOP and ask the user to author it per `providers/_index.md`.

**Derive mode only**: if `repoContext` came from git-remote derivation and the provider needs an identity the remote did not supply (e.g. ADO `repo-guid`), run the provider's identity-resolution recipe now (ADO: *Resolving repo identity in derive mode* in `providers/ado.md`). In registry mode the entry already carries these, so skip.

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
