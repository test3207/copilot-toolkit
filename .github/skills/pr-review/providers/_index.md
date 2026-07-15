# pr-review providers

Provider modules decouple `pr-review` from any single PR host. The workflow is platform-agnostic; everything host-specific lives in `providers/{name}.md`.

## How the main agent uses this

1. **Resolve provider** (workflow Step 1): read `repoContext.pr-platform` (from the matched registry entry, or derived from the git remote in derive mode). If missing, default to `ado` (back-compat). Then read `providers/{pr-platform}.md`.
2. **Treat the provider file as a contract**: it MUST expose the sections listed in the [Provider Contract](#provider-contract) below. Run the recipe under each section verbatim.
3. **Inject derived values into subagents**: the workflow Step 7 dispatch passes `fileLinkTemplate` and `forbiddenAutoLinkPatterns` (both built from the provider file + Step 1 PR response) to every subagent. Subagents do NOT know which platform is in use.

**Preflight + access method**: before fetching, workflow Step 0 runs `scripts/preflight.mjs --platform {pr-platform}` to probe the real dependencies (node, git, and the platform's auth CLI). It returns a capability report + a recommended access method and, for anything missing, the exact install / sign-in command. Step 0 resolves the provider's access method (see each provider's `## accessMethods`) from the preflight result + any `.github/pr-review.json` override; a missing hard dependency (node, git, or the platform credential -- `az` for ADO, `gh` / `GITHUB_TOKEN` for GitHub) STOPS the run with remediation. There is no offline mode.

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
| `## accessMethods` | How the provider authenticates + the `auto` resolution order across its transports (MCP / CLI / REST) and the hard-stop when the required credential is missing. Workflow Step 0 resolves the method after the preflight doctor. |

Optional sections (use when applicable):

- `## fetchDiff` — override if the platform needs something other than `git diff origin/{target}...HEAD`.
- `## setupWorktree` — documents a platform-specific source-ref fetch when `git fetch origin {sourceBranch}` can't resolve the PR head (e.g. a GitHub fork PR, whose head is not on `origin` — it lives at `refs/pull/{prId}/head`). Step 3's `scripts/pr-review-worktree.mjs setup` owns the entire worktree flow (availability probe, output scaffold + self-ignore, pre-clean/prune, fetch source+target, detached add, optional enrichment, diff + submodule-bump summary) and fetches `origin/{sourceBranch}`; it does not yet accept a custom source ref, so **fork-PR review is not currently supported** on any provider. The searchable worktree always lands at `pr-review-worktree/{repo}/{prId}/worktree` (NOT ignored) and outputs at `pr-review/{repo}/{prId}` (self-ignored) — Step 4 and Step 7 subagents hard-code those locations.

**Worktree enrichment config precedence** (the `worktree` block: `{ submodules, setup }`): reviewed-repo `.github/pr-review.json` `worktree` > registry entry `worktree` (passed to the script via `--config`) > default OFF. This block is L3-owned, so it wins even in registry mode (the one documented exception to "registry mode ignores `pr-review.json`"); orchestration fields (`pr-platform`, `path`, `repo-guid`, …) still follow the normal registry-wins rule. The script reads the L3 block from the **base checkout**, never the PR source, so a PR can't inject `setup` commands. Enrichment is opt-in / trusted-repos-only and always degrades to a non-blocking warning on failure. See SKILL.md → *Optional `.github/pr-review.json`*.

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
| `ado` | [ado.md](ado.md) | `az`/REST + `repo_*` MCP optional |
| `github` | [github.md](github.md) | `gh` CLI + REST |
| `gitlab` | (not shipped) | TODO when first GitLab consumer requests it. Author per this contract. |
