# pr-review providers

Provider modules decouple `pr-review` from any single PR host. The workflow is platform-agnostic; everything host-specific lives in `providers/{name}.md`.

## How the main agent uses this

1. **Resolve provider** (workflow Step 1): read the matched registry entry's `pr-platform` field. If missing, default to `ado` (back-compat). Then read `providers/{pr-platform}.md`.
2. **Treat the provider file as a contract**: it MUST expose the sections listed in the [Provider Contract](#provider-contract) below. Run the recipe under each section verbatim.
3. **Inject derived values into subagents**: the workflow Step 7 dispatch passes `fileLinkTemplate` and `forbiddenAutoLinkPatterns` (both built from the provider file + Step 1 PR response) to every subagent. Subagents do NOT know which platform is in use.

## Provider Contract

Every `providers/{name}.md` MUST contain these sections, in this order, with these exact H2 headings:

| Heading | Purpose |
| --- | --- |
| `## Registry fields required` | List of registry keys the provider expects in the matched repo entry. Workflow Step 1 validates presence. |
| `## getPrInfo` | Recipe to fetch PR metadata. MUST produce the standard `prInfo` object documented below. |
| `## getThreads` | Recipe to fetch existing PR comments/threads. Used by workflow Step 2 to avoid duplicate comments. |
| `## fileLinkTemplate` | Template string with `{path}`, `{startLine}`, `{endLine}` placeholders + concrete substitution example + handling rule for single-line refs. |
| `## autoLinkForbiddenPatterns` | Table of `pattern` (regex) + `autoLinksTo` (what the host turns it into) + `safeReplacement` (what subagents should write instead). Workflow Step 9.1b loops through this list. |
| `## postComment` | Recipe to POST the assembled `pr-comment.md` body to the PR. Prefer terminal-only paths (CLI or REST) so the body never re-enters main-agent context. |

Optional sections (use when applicable):

- `## fetchDiff` — override if the platform needs something other than `git diff origin/{target}...HEAD`.
- `## checkoutBranch` — override if the platform needs something other than `git fetch origin {ref}; git checkout {ref}`.

### Standard `prInfo` object

`getPrInfo` MUST emit (or document how to extract) these fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `prId` | string | yes | The PR number (or platform-equivalent ID). |
| `title` | string | yes | |
| `description` | string | yes | Empty string OK. |
| `author` | string | yes | Display name. |
| `sourceBranch` | string | yes | Short ref (no `refs/heads/`). |
| `targetBranch` | string | yes | Short ref. |
| `state` | enum | yes | `active` \| `merged` \| `closed` \| `abandoned`. Skip review if not `active`. |
| `created` | ISO-8601 string | yes | |
| `reviewers` | list of `{name, vote}` | yes | Empty list OK. |
| `headSha` | string | yes | SHA of the source branch head (needed by some `fileLinkTemplate`s). |
| `additions` | number | yes | Total `+` lines. |
| `deletions` | number | yes | Total `-` lines. |
| `changedFiles` | number | yes | File count. |
| `workItemRefs` | list of strings | no | If platform supports linked work items (ADO), surface them; else omit. |
| `repoNameForLinks` | string | yes | The short repo identifier used inside `fileLinkTemplate` (e.g. ADO `repository.name`, GitHub `repo`). |

### Standard `fileLinkTemplate` rules

The template MUST:

1. Be a single line.
2. Contain `{path}` (repo-relative, leading `/` if the host requires it).
3. Contain `{startLine}`.
4. Either contain `{endLine}` OR document how to omit it for single-line refs.
5. Resolve to an absolute URL when substituted.

The workflow Step 5 substitutes any registry/PR values (e.g. `{org}`, `{prId}`, `{headSha}`) before passing the template to subagents — subagents only substitute `{path}`/`{startLine}`/`{endLine}`.

### Standard `autoLinkForbiddenPatterns` entry

Each row:

```
| Pattern | Auto-links to | Safe replacement |
| --- | --- | --- |
| `#\d+` | (GitHub) issue/PR with that number | `[N]` for finding refs, `Issue N` (no `#`) for issue refs |
```

Workflow Step 9.1b runs `Select-String -Path pr-comment.md -Pattern <each-pattern>`. Any match aborts the post.

## Defaulting + missing provider

- Missing `pr-platform` in registry → default to `ado` (back-compat for entries authored before this seam existed).
- `pr-platform` value with no matching `providers/{value}.md` file → workflow Step 1 STOPS and asks the user to add the provider (do not silently fall back).

## Currently shipped providers

| `pr-platform` | File | Tool surface |
| --- | --- | --- |
| `ado` | [ado.md](ado.md) | `repo_*` MCP + REST/`az` fallback |
| `github` | [github.md](github.md) | `gh` CLI + REST fallback |
| `gitlab` | (not shipped) | TODO when first GitLab consumer requests it. Author per this contract. |
