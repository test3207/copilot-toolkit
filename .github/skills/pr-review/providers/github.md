# GitHub provider (pr-platform: github)

Recipes for reviewing PRs hosted on GitHub (`github.com` / GHES). Prefers `gh` CLI for simplicity; falls back to REST + token when `gh` is unavailable.

## Registry fields required

The `repoContext` (from a matched registry entry, OR derived in derive mode) MUST resolve these:

| Field | Example | Notes |
| --- | --- | --- |
| `github-owner` | `octocat` | The repo owner (user or org). In **derive mode** this is the `owner` parsed from the git remote. |
| `github-repo` | `hello-world` | The repo short name. In derive mode this is the derived `repoName`. |
| `github-host` | `github.com` | Optional. Defaults to `github.com`; override for GHES (registry `github-host` or `.github/pr-review.json`). |

`gh` CLI MUST be authenticated for the host (`gh auth status` must show `Logged in`). If not, instruct the user to run `gh auth login` — do not attempt interactive auth from the agent.

## getPrInfo

Primary path (terminal `gh` — body never enters main-agent context):

```pwsh
$prId = '{prId}'
$repo = '{repo}'
$owner = '{registry.github-owner}'
$repo = '{registry.github-repo}'
$host = '{registry.github-host OR github.com}'
$repoFlag = if ($host -eq 'github.com') { "$owner/$repo" } else { "$host/$owner/$repo" }
gh pr view $prId --repo $repoFlag --json `
  number,title,body,author,headRefName,baseRefName,headRefOid,state,isDraft,createdAt,reviewRequests,reviews,additions,deletions,changedFiles,closingIssuesReferences `
  > "pr-review/$repo/$prId/raw-pr.json"
```

Fallback (REST when `gh` is unavailable):

```pwsh
$token = $env:GITHUB_TOKEN  # or gh auth token
$apiBase = if ($host -eq 'github.com') { 'https://api.github.com' } else { "https://$host/api/v3" }
Invoke-RestMethod -Uri "$apiBase/repos/$owner/$repo/pulls/$prId" `
  -Headers @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json' } `
  | ConvertTo-Json -Depth 6 | Set-Content "pr-review/$repo/$prId/raw-pr.json"
```

### Mapping to standard `prInfo`

| Standard field | GitHub source (gh JSON) |
| --- | --- |
| `prId` | `number` |
| `title` | `title` |
| `description` | `body` |
| `author` | `author.login` |
| `sourceBranch` | `headRefName` |
| `targetBranch` | `baseRefName` |
| `state` | `state` mapped: `OPEN`→`active`, `MERGED`→`merged`, `CLOSED`→`closed`. If `isDraft` is true AND state is OPEN → treat as `active` but flag in TL;DR. |
| `created` | `createdAt` |
| `reviewers` | Union of `reviewRequests[*].login` (pending) and `reviews[*]` reduced to `{ name: author.login, vote: state }`. GitHub `state` values: `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `DISMISSED`. |
| `headSha` | `headRefOid` — REQUIRED by `fileLinkTemplate` below. |
| `additions` / `deletions` / `changedFiles` | direct fields. |
| `workItemRefs` | `closingIssuesReferences[*]` (issues linked via "Fixes #N" in description) — surface as `{owner}/{repo}#{number}` strings. |
| `repoNameForLinks` | `{owner}/{repo}` (used inside `fileLinkTemplate`). |

## getThreads

GitHub PRs have two distinct comment surfaces — fetch BOTH:

1. **Issue comments** (general PR conversation, posted via "Add a comment"):

   ```pwsh
   gh pr view $prId --repo $repoFlag --comments > "pr-review/$repo/$prId/raw-issue-comments.txt"
   ```

2. **Review comments** (file-anchored, posted via "Review changes"):

   ```pwsh
   gh api "repos/$owner/$repo/pulls/$prId/comments" > "pr-review/$repo/$prId/raw-review-comments.json"
   ```

### Filtering

- Ignore comments authored by bots: `author.login` ends with `[bot]` (e.g. `github-actions[bot]`, `dependabot[bot]`).
- File-anchored comments expose `path`, `line`, and `original_line` fields.
- Review states: `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`. A `DISMISSED` review is invalidated by a subsequent push.

## fetchDiff

Optional override of Step 4's default (`git --no-pager diff origin/{target}...HEAD`). Use it **only** as a fallback when that three-dot diff is empty because the PR is already merged (its head is an ancestor of the target) -- e.g. a Step 1 override that reviews a merged PR. `gh pr diff` returns the canonical PR patch regardless of merge state:

```pwsh
# $repoFlag is built exactly as in getPrInfo (host-qualified for GHES)
$prId = '{prId}'
$repo = '{repo}'
gh pr diff $prId --repo $repoFlag > "pr-review/$repo/$prId/diff.txt"
```

## fileLinkTemplate

Use the **permalink** form (anchored to `headSha`) — it survives subsequent pushes to the source branch, unlike `/pull/{prId}/files#diff-{hash}` which uses fragile diff hashes:

```text
https://{host}/{owner}/{repo}/blob/{headSha}/{path}#L{startLine}-L{endLine}
```

Substitution rules:

- `{host}`, `{owner}`, `{repo}`, `{headSha}` — workflow Step 5 substitutes these BEFORE passing the template to subagents.
- `{path}` — repo-relative, NO leading `/`. URL-encode spaces (`%20`); slashes stay literal.
- `{startLine}` — 1-based.
- `{endLine}` — 1-based. For a single-line ref, OMIT `-L{endLine}` entirely (write `#L{startLine}` only). The template recipient is responsible for this omission — do NOT emit `#L42-L42`, write `#L42`.

Concrete example (`octocat/hello-world` at SHA `abc123`):

```text
https://github.com/octocat/hello-world/blob/abc123def456/src/foo.ts#L42-L88
```

Single-line example:

```text
https://github.com/octocat/hello-world/blob/abc123def456/src/foo.ts#L42
```

The post-substitution template that subagents receive looks like:

```text
https://github.com/octocat/hello-world/blob/abc123def456/{path}#L{startLine}-L{endLine}
```

(Subagent applies the single-line omission rule itself.)

### Why permalink, not diff view

`/pull/{prId}/files#diff-{base64-hash}R{N}` works but the `diff-{hash}` part is computed from the file path and breaks when the file moves; `blob/{sha}/{path}#L{N}` is permanent and human-readable.

## autoLinkForbiddenPatterns

GitHub auto-links several bare patterns in posted comments. Subagents must avoid them.

| Pattern (regex) | Auto-links to | Safe replacement |
| --- | --- | --- |
| `#\d+` | Issue or PR with that number in the same repo | `[N]` for cross-finding refs; `Finding 5` (no `#`) for prose; `{owner}/{repo}#N` for intentional cross-repo issue refs (already an absolute auto-link target — fine); `GH-1234` for plain text mentions |
| `@[A-Za-z0-9-]+` | User or team mention (sends a notification) | `@<user>` only when an actual at-mention is intended; otherwise write the name without `@`, or escape as `\@user` |
| `\b[0-9a-f]{7,40}\b` (bare hex) | Commit in the same repo | Wrap in a Markdown link `[abc1234](https://github.com/.../commit/abc1234567)` or quote as inline code `` `abc1234` `` |
| `GH-\d+` | Issue/PR (alt syntax for `#N`) | Use sparingly; same rule as `#N`. |

Patterns NOT matched by `#\d+` (safe):

- Markdown headings: `# Title`, `## Section`.
- File line anchors in link display text: `[Foo.ts#L42](url)` — letter prefix.
- URL parameters: `?line=42` — no `#`.

Patterns NOT matched by `@<word>` (safe):

- Email addresses inside link targets: `mailto:foo@bar.com`.
- Code blocks (GitHub does not auto-link inside `` ``` ``).

## postComment

Primary path (`gh` CLI — body never re-enters main-agent context):

```pwsh
$prId = '{prId}'
$repo = '{repo}'
$owner = '{registry.github-owner}'
$repo = '{registry.github-repo}'
$host = '{registry.github-host OR github.com}'
$repoFlag = if ($host -eq 'github.com') { "$owner/$repo" } else { "$host/$owner/$repo" }
gh pr comment $prId --repo $repoFlag --body-file "pr-review/$repo/$prId/pr-comment.md"
```

Returns the URL of the posted comment.

Fallback (REST when `gh` is unavailable):

```pwsh
$token = $env:GITHUB_TOKEN
$apiBase = if ($host -eq 'github.com') { 'https://api.github.com' } else { "https://$host/api/v3" }
$body = Get-Content -Raw "pr-review/$repo/$prId/pr-comment.md"
$payload = @{ body = $body } | ConvertTo-Json -Depth 3
Invoke-RestMethod -Uri "$apiBase/repos/$owner/$repo/issues/$prId/comments" `
  -Method POST -Body $payload -ContentType 'application/json' `
  -Headers @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json' } `
  | Select-Object -Property id, html_url | ConvertTo-Json
```

### Why issue comment, not review

`POST /repos/{owner}/{repo}/issues/{number}/comments` creates a single top-level PR comment — equivalent to the "Add a comment" button. This is the right surface for a holistic AI review.

A "review" (`POST /pulls/{number}/reviews`) is per-file with line-anchored comments and a single APPROVE / REQUEST_CHANGES / COMMENT event. That requires splitting `pr-comment.md` into per-line comments, which we deliberately do NOT do (the curated holistic comment is the product).

### Auth pitfall

`gh` CLI handles auth via keyring. For REST fallback, `$env:GITHUB_TOKEN` is the standard env var; `gh auth token` prints the current keyring token if you need to inject it. Never paste a token into the agent context; export it in the shell.
