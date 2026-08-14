# Step 0–5: Setup, Fetch, Section Scaffolding

Sourced from [workflow.md](../workflow.md). Main agent runs these sequentially.

## Step 0: Resolve provider

Read `repoContext.pr-platform` (from the matched registry entry in registry mode, or the derived value in derive mode). If missing, default to `ado` (back-compat). Read `providers/{pr-platform}.md` -- this provider file defines `getPrInfo`, `getThreads`, `fileLinkTemplate`, `autoLinkForbiddenPatterns`, and `postComment` recipes used by Steps 1, 2, 5, 7, 9.1b, and 9.2 below.

If `providers/{pr-platform}.md` does not exist, STOP and ask the user to author it per `providers/_index.md`.

**Derive mode only**: if `repoContext` came from git-remote derivation and the provider needs an identity the remote did not supply (e.g. ADO `repo-guid`), run the provider's identity-resolution recipe now (ADO: *Resolving repo identity in derive mode* in `providers/ado.md`). In registry mode the entry already carries these, so skip.

**Preflight + access method**: run `node .copilot-toolkit/scripts/preflight.mjs --platform {pr-platform} --mcp-configured <true if repoContext has an ado-repo-server, else false>` (the entry prompt may have already done this and passed the result). If the report's `blocking` is non-empty (node / git / the platform credential `az` or `gh` missing) STOP and surface its `remediation` -- there is no offline mode. Resolve the provider access method (`ado-access` / `gh-access`) = explicit `.github/pr-review.json` override, else the report's `access.recommended`. Steps 1, 2, and 9 run the recipe variant for the resolved method. See `providers/{pr-platform}.md` -> `accessMethods`.

**Resolve post-mode** (gates Step 9.2): `node .copilot-toolkit/scripts/pr-review-config.mjs resolve --repo-path {repoContext.path} [--post-mode <cli flag if the caller passed --auto/--confirm/--skip-post>]`. Capture `postMode` (`confirm` default | `auto` | `skip`). If the JSON has `firstRun: true`, surface its `notice` ONCE (non-blocking: three modes + the `auto` safety warning). The entry prompt may have already resolved this and passed `post-mode` -- if so, skip. Precedence and the machine-local `.github/pr-review.local/` file are documented in SKILL.md.

## Step 1: Get PR Info

Run the **getPrInfo** recipe from `providers/{pr-platform}.md`. Extract the standard `prInfo` object (fields documented in `providers/_index.md`). Skip the review if `state` is not `active`.

## Step 2: Get Existing PR Comments

Run the **getThreads** recipe from `providers/{pr-platform}.md`. Filter out bot/system messages per the provider's filtering guidance. Note existing feedback and open issues to avoid duplicate comments.

## Step 3: Create Isolated Worktree (parallel-safe)

Instead of checking the PR branch out in the shared working tree (which fights concurrent reviews and disturbs the user's own checkout), create a dedicated git worktree per review. Two reviews of different PRs run in parallel because each gets its own detached HEAD; the user's working tree is never touched.

`scripts/pr-review-worktree.mjs` does all the deterministic git glue in one Node run (the "recipe glue = Node script" rule -- no inline multi-step shell): probe worktree availability, scaffold the self-ignored output tree, run a cross-repo orphan sweep (deletes orphan leaves under ALL repos' review dirs, not only the current `--repo`/`--pr-id`), regenerate the `pr-review-worktree/.gitignore` denylist, allocate a candidate worktree path (`worktree`, `worktree-2`, ..., `worktree-10`), fetch source + target, add the detached worktree, run optional enrichment, then compute the diff + submodule-bump summary. Every git call runs against `{repoContext.path}` via `git -C`, so it works whether the reviewed repo is the workspace root (`path: "."`, plugin mode) or a git submodule (`path: "repos/<name>"`, L2 mode).

**Enrichment config (optional)**: the script reads the reviewed repo's own `.github/pr-review.json` `worktree` block (L3, from the base checkout) automatically. If instead the registry entry carries a `worktree` block (L2), write it to a JSON file with `create_file` (e.g. `pr-review/{repo}/{prId}/worktree-config.json`) and pass `--config <that path>` -- L3 still overrides L2 if both exist. If the registry has no `worktree` block, omit `--config`. See `providers/_index.md` → *Worktree enrichment config precedence*.

```sh
node .copilot-toolkit/scripts/pr-review-worktree.mjs setup \
  --repo-path {repoContext.path} --repo {repo} --pr-id {prId} \
  --source {sourceBranch} --target {targetBranch}
```

The script prints ONE JSON object to stdout -- capture it as `worktreeInfo`:

| Field | Use |
| ----- | --- |
| `worktree` | Absolute path of the searchable worktree (NOT ignored). Typically `pr-review-worktree/{repo}/{prId}/worktree`; may carry a `-N` suffix when the primary path was occupied by a locked leftover. Forward this value verbatim to subagents -- do NOT reconstruct from `{repo}/{prId}`. |
| `orphans` | `{ count, files, bytes, hidden: true }` -- present only when orphan leaves survived the pre-setup sweep. A matching warning is in `warnings[]`. Orphans are hidden from git/search via `pr-review-worktree/.gitignore`; restart the editor to release held handles so the next review reclaims the path. |
| `outDir` | `pr-review/{repo}/{prId}` (self-ignored) -- holds `diff.txt`, `changed-files.txt`, sections. |
| `diffFile` | Full-patch path for Step 7 subagents. |
| `changedFiles` / `additions` / `deletions` | Change-size signal for Step 4. |
| `submoduleBumps` | `[{ path, from, to, commits? }]` gitlink pointer bumps (empty for most PRs; `commits` present only when submodule enrichment resolved the range). |
| `enrichment` | `{ submodules, configSource, submoduleUpdate, setup, hint? }` -- what the opt-in enrichment did. If `hint` is present (plugin mode, nothing configured), surface it ONCE, non-blocking. |
| `warnings` | Non-fatal notes (stale target fetch B-031, degraded enrichment) -- surface to the user. |

Exit codes: `0` = ok; `1` = bad arguments; `2` = git setup failure (worktree unavailable / source fetch / add) -- on non-zero STOP and surface the JSON `error` field.

> The worktree lives at a NON-ignored, in-workspace path so VS Code grep / file / semantic search reach it directly (search cannot see system-temp or ignored files). Review OUTPUT artifacts stay under the self-ignored `pr-review/` tree. The worktree is removed in Step 9.3.
> Isolation is guaranteed across DIFFERENT PRs (distinct `{prId}` -> distinct worktree path). Same-PR SEQUENTIAL re-review is supported: the pre-setup orphan sweep removes any leftover from a prior cleanup, and the candidate allocation takes `worktree-N` when `worktree` is still locked. Same-PR PARALLEL review remains out of scope: two concurrent setups for the same PR would race over the same candidate paths.

## Step 4: Get Changed Files

Step 3's script already computed and persisted the change set -- no extra `git` needed. Read from `worktreeInfo`:

- Changed-file list: `pr-review/{repo}/{prId}/changed-files.txt` (count = `worktreeInfo.changedFiles`).
- Full patch for Step 7 subagents: `worktreeInfo.diffFile` (`pr-review/{repo}/{prId}/diff.txt`) -- the Step 7 dispatch template references this exact path.
- Size: `worktreeInfo.additions` / `worktreeInfo.deletions`.
- Submodule pointer bumps: `worktreeInfo.submoduleBumps`. If non-empty, note each `{path}: {from}..{to}` in the review. When submodule enrichment is enabled, a bump also carries `commits` (the resolved `from..to` log) -- summarize those instead of the bare pointer, since a lone gitlink bump hides the submodule's real change. Deep diff is opt-in (see `providers/_index.md`).

> **Empty diff on an already-merged PR**: the `target...source` range yields an empty patch when the source is already an ancestor of the target (the PR was merged). Normal reviews never hit this -- Step 1 skips non-`active` PRs -- but when you deliberately review a merged PR (a Step 1 override), fall back to the provider's `fetchDiff` recipe (GitHub: `gh pr diff {prId}`; see `providers/{pr-platform}.md`) so Step 7 analyzes the real change set, not an empty file.

**Context budget signal**: If `worktreeInfo.changedFiles` > 30 OR diff lines > 800, set `contextPressure = high`. This signals only -- subagents in Step 7 are mandatory regardless of this flag.

## Step 5: Create section dir + header + metadata + build fileLinkTemplate

```sh
node .copilot-toolkit/scripts/pr-review-assemble.mjs init --repo {repo} --pr-id {prId}
```

This creates `pr-review/{repo}/{prId}/sections/` and clears any prior `*.md` so a subagent's `create_file` doesn't collide on re-run.

From the provider file's `fileLinkTemplate` definition, substitute every host/registry/`prInfo`-derived placeholder (e.g. `{org}`, `{repo}`, `{prId}`, `{headSha}`) using the values from Step 1 + the matched registry entry. The result is `fileLinkTemplate` -- a string containing ONLY the per-finding placeholders `{path}`, `{startLine}`, `{endLine}`. Remember this string for Step 7 dispatch and Step 8 Action Items.

Also compute `forbiddenAutoLinkPatterns` -- the full table from the provider's `autoLinkForbiddenPatterns` section (regex pattern, what it auto-links to, and the safe replacement). Pass it as input to every Step 7 subagent dispatch so they apply the same rules.

Concrete example: see `providers/{pr-platform}.md` for substituted-template and pattern-table examples.

Write `pr-review/{repo}/{prId}/sections/00-header.md`:

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
