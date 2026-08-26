# onboard-repo providers

Provider modules decouple `/onboard-repo` from any single VCS host. The orchestrating prompt is platform-agnostic; everything host-specific lives in `providers/{name}.md`.

## How the main agent uses this

1. **Resolve provider** (prompt Step 0): walk the provider list below in order, applying each provider's `URL detection` regex against the user-supplied repo URL. First match wins.
2. **Treat the provider file as a contract**: it MUST expose the sections listed in [Provider Contract](#provider-contract) below. Run the recipe under each section verbatim.
3. **Generic steps stay in the prompt**: `git submodule add`, `registry/index.md` row append, commit. Provider recipes only own host-specific work (URL parsing, repo identity lookup, ownership resolution, registry block emission).

## Provider Contract

Every `providers/{name}.md` MUST contain these sections, in this order, with these exact H2 headings:

| Heading | Purpose |
| --- | --- |
| `## URL detection` | Regex (or hostname list) the orchestrator uses to dispatch. First match wins; order in [Currently shipped providers](#currently-shipped-providers) is authoritative. |
| `## Registry fields produced` | List of registry keys this provider populates (or marks `TODO`). The orchestrator validates the resulting registry file contains every required key. |
| `## parseRepoUrl` | Recipe to extract repo identity from the URL into a standard `repoInput` object (fields below). |
| `## getRepoMetadata` | Recipe to fetch any platform-side data the registry entry needs that is NOT derivable from the URL alone (GUID, default branch, etc.). |
| `## resolveOwnership` | Recipe to resolve ownership metadata (ADO area-path from WI, GitHub CODEOWNERS, etc.). MAY return `TODO` if the host has no equivalent — orchestrator records it as a registry TODO. |
| `## registryTemplate` | The provider-specific block to render into `registry/{repo-name}.md` (after the generic header). |

Optional sections:

- `## mcpTools` — if the provider needs MCP tools (not terminal-only), list the tool IDs the consuming prompt's `tools:` allowlist must contain. The orchestrator STOPs if any required tool is missing from the prompt's `tools:` block; see Step 3 of the skill.
- `## downstreamPromptUpdates` — if onboarding a repo on this host requires editing a consuming prompt's `tools:` allowlist (e.g. to add a per-org ADO MCP server), document the edit here.

### Standard `repoInput` object

`parseRepoUrl` MUST emit (or document how to extract) these fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `host` | string | yes | Hostname (e.g. `dev.azure.com`, `github.com`, `gitlab.example.com`). |
| `org` | string | yes | Org / owner / group. For generic git, may be the path segment before the repo name. |
| `project` | string | yes for ADO; empty string otherwise | ADO project name. Empty for GitHub / GitLab / generic. |
| `repoName` | string | yes | Short repo identifier (no `.git` suffix). |
| `cloneUrl` | string | yes | HTTPS or SSH URL suitable for `git submodule add`. The orchestrator uses this as-is. |

### `resolveOwnership` return shape

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | string | One of: `area-path` (ADO), `codeowners` (GitHub), `none` (generic). |
| `value` | string | The resolved value (`OS\Core\CMD\AVD\...` for ADO, `.github/CODEOWNERS` for GitHub, empty for generic). |
| `registryKey` | string | The registry key this value lands under (`area-path`, `codeowners-path`, or `TODO`). |

If the provider cannot auto-resolve, set `value = "TODO"` and the orchestrator records it as a registry TODO without blocking onboarding.

## Defaulting + unknown URLs

- If no provider's `URL detection` regex matches, fall back to `generic-git` (always matches any URL that looks like a git remote: ends in `.git` OR parses as `host:path/repo`).
- If even `generic-git` cannot parse the URL, STOP and ask the user to paste a valid git remote URL.

## Currently shipped providers

Dispatch order (first match wins):

| # | `provider` | File | URL pattern summary | Tool surface |
| --- | --- | --- | --- | --- |
| 1 | `ado` | [ado.md](ado.md) | `*.visualstudio.com/.../_git/...` or `dev.azure.com/.../_git/...` | ADO REST + `ado-*` MCP tools |
| 2 | `github` | [github.md](github.md) | `github.com/{owner}/{repo}` or GHES `<host>/{owner}/{repo}` | `gh` CLI + REST fallback |
| 3 | `gitlab` | (not shipped) | TODO when first GitLab consumer requests it. Author per this contract. |
| 4 | `generic-git` | [generic-git.md](generic-git.md) | Any other git remote (`*.git`, `git@host:owner/repo`, etc.) | git CLI only; ownership = user-supplied |
