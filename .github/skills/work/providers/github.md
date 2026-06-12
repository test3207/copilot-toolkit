# Provider: GitHub (Issues)

Concrete implementation of the issue-tracker contract for GitHub Issues. Uses the `gh` CLI as the primary surface — assumed available on the consumer's machine because they already use it for PRs.

> Sub-issues / parent-child links: GitHub added native sub-issues in 2024 but coverage varies across repos. This provider defaults to **task-list checkbox in parent body** (universally supported) and notes the native API as a future swap.

## Required registry fields

| Field | Notes |
| ----- | ----- |
| `github-repo` | `<owner>/<repo>` (e.g. `octocat/Hello-World`) |
| `github-host` | (optional) GitHub Enterprise hostname; omit for public github.com |
| `feature-label` | (optional) label that marks abstract `feature`; default `feature` |
| `bug-label` | (optional) label that marks abstract `bug`; default `bug` |
| `default-parent-issue` | (optional) issue number used when `createItem(parent=null, type=feature)` and user does not supply one |

## Operations

### `parseItemUrl(url)`

Match patterns:

- `https://github.com/<owner>/<repo>/issues/<id>`
- `https://<github-host>/<owner>/<repo>/issues/<id>` (GHE)

Return `{ id, providerHint: "github", owner, repo }`. Otherwise `null`.

> `.copilot-toolkit/scripts/parse-input.mjs` upstream version covers the public github.com pattern. Consumers using GHE register their host via the same env-gate mechanism used by ICM (`process.env.GITHUB_HOST_PATTERN`).

### `getItem(id)`

```bash
gh issue view <id> --repo <github-repo> --json number,title,body,labels,assignees,comments,projectItems,url
```

Map response:

| Abstract field | GitHub source |
| -------------- | ------------- |
| `title` | `title` |
| `body` | `body` (Markdown) |
| `type` | by label — `feature-label` ⇒ `feature`, `bug-label` ⇒ `bug`, else `task` |
| `parentId` | scan parent's task-list checkboxes that reference this issue (`gh search issues "<id> in:body type:issue"` and pick the parent that has this id in a `- [ ]` line) — best-effort; if multiple, return the first match. Native sub-issues API (`gh api /repos/{owner}/{repo}/issues/{id}/sub_issues`) is the preferred swap when the repo opts in. |
| `attachments` | none — GitHub embeds attachments in `body` as image/file URLs; surface raw body |
| `comments` | `comments` array (each `{author, body, createdAt}`) |

### `createItem({ type, title, body, parentId? })`

```bash
gh issue create \
  --repo <github-repo> \
  --title "<title>" \
  --body  "<body>" \
  --label "<map type: feature→<feature-label>, bug→<bug-label>>"
```

Capture stdout — `gh` prints the new issue URL on the last line; parse `<id>` from it.

IF `parentId` set (or resolved from `default-parent-issue`):

```bash
gh issue edit <parentId> --repo <github-repo> --add-body "- [ ] #<newId>"
```

(Or, if the repo opts into native sub-issues: `gh api /repos/{owner}/{repo}/issues/{parentId}/sub_issues -f sub_issue_id=<newId>` — provider may upgrade per-repo.)

Returns `{ id, url }`.

### `addChildren(parentId, items[])`

For each item: call `createItem({ ...item, parentId })` sequentially. Collect ids.

### `addComment(id, body)`

```bash
gh issue comment <id> --repo <github-repo> --body "<body>"
```

### `linkPR(itemId, prUrl)`

GitHub auto-links by writing `Closes #<itemId>` (or `Refs #<itemId>` for non-closing link) in the PR body. The `gh pr create` call in `shared.md` PR step already accepts a `--body` flag — include the line there.

`prDescriptionLink` below carries the literal text; provider does NOT need a separate API call.

### `commitMessageSuffix(itemId)`

Return `(#<itemId>)`. GitHub auto-links `#<n>` references in commit views.

### `prDescriptionLink(itemId)`

Return markdown:

```markdown
Closes #<itemId>
```

(Use `Refs #<itemId>` instead if the PR resolves only part of the issue.)

## Labels-as-area-path

GitHub Issues lacks ADO's hierarchical area-path. For consumers running multi-repo from one issue-tracker repo, use **labels** as the substitute:

1. Registry entry per repo declares a `github-label` field (e.g. `area:portal`).
2. Step 0 area-matching against ADO `area-path` becomes label-matching: read `labels[]`, match against each registered repo's `github-label`.

If consumer has 1:1 issue-repo : code-repo mapping, this step is skipped.

## GHE / corporate gotchas

- `gh` CLI honors `GH_HOST` env var or `gh auth login --hostname` for GHE. Provider operations assume the user has already authenticated against the correct host.
- Some GHE installs disable Issues per-repo; verify with `gh repo view <github-repo> --json hasIssuesEnabled` before declaring this provider in registry.
- Public-github org SSO: if `gh` returns 401 for a public org, the user needs `gh auth refresh -h github.com -s read:org` once.
