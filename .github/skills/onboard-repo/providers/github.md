# GitHub provider (onboard-repo)

Recipes for onboarding a repository hosted on GitHub (`github.com`) or GitHub Enterprise Server (GHES).

## URL detection

```regex
^https?:\/\/(?<host>github\.com|[\w.-]+)\/(?<owner>[^/]+)\/(?<repo>[^/?#.]+)(?:\.git)?\/?(?:$|[?#])
```

To distinguish GHES from generic git, require `gh auth status --hostname <host>` to succeed (host has a configured `gh` auth profile). If `gh` is not authenticated for the host, fall back to `generic-git`.

For `github.com`: always claim the match if the URL parses.

## Registry fields produced

This provider populates:

| Key | Source |
| --- | --- |
| `pr-platform` | Literal `github`. |
| `github-host` | `parseRepoUrl.host` (omit if equals `github.com` — default). |
| `github-owner` | `parseRepoUrl.owner`. |
| `github-repo` | `parseRepoUrl.repoName`. |
| `default-branch` | `getRepoMetadata.defaultBranch`. |
| `codeowners-path` | `resolveOwnership` (or `TODO`). |

Provider does NOT set: `build`, `frameworks`, `coding-standards`, `icm-teams`, `kusto`, `bot-identity-ids`, `feature-gating`, `pr-template`. Those are marked `TODO` by the orchestrator's generic step.

## parseRepoUrl

Apply the `URL detection` regex; emit:

```jsonc
{
  "host": "<github.com or GHES host>",
  "org": "<owner>",
  "project": "",
  "repoName": "<repo without .git suffix>",
  "cloneUrl": "https://<host>/<owner>/<repo>.git"
}
```

## getRepoMetadata

Primary path (`gh` CLI — must be authenticated; if not, instruct user to run `gh auth login` first):

```pwsh
$owner = '<owner>'
$repo = '<repoName>'
$host = '<github.com or GHES host>'
$repoFlag = if ($host -eq 'github.com') { "$owner/$repo" } else { "$host/$owner/$repo" }
gh repo view $repoFlag --json id,defaultBranchRef,isPrivate,visibility
```

Return values used by the registry entry:

| Standard field | GitHub source (gh JSON) |
| --- | --- |
| `defaultBranch` | `defaultBranchRef.name` |
| `repoNodeId` | `id` (GraphQL node ID; informational, not required by tools) |

Fallback (REST when `gh` is unavailable):

```pwsh
$token = $env:GITHUB_TOKEN  # or `gh auth token`
$apiBase = if ($host -eq 'github.com') { 'https://api.github.com' } else { "https://$host/api/v3" }
Invoke-RestMethod -Uri "$apiBase/repos/$owner/$repo" `
  -Headers @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json' }
```

## resolveOwnership

GitHub has no `area-path` equivalent. The closest analogue is `CODEOWNERS`.

After the submodule is added (orchestrator Step 2), probe for a CODEOWNERS file in the standard locations:

```pwsh
$repoPath = 'repos/<repoName>'
$candidates = @('.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS')
$found = $candidates | Where-Object { Test-Path (Join-Path $repoPath $_) } | Select-Object -First 1
```

Return:

```jsonc
// If CODEOWNERS found:
{ "kind": "codeowners", "value": "<.github/CODEOWNERS or wherever found>", "registryKey": "codeowners-path" }

// If not found:
{ "kind": "codeowners", "value": "TODO", "registryKey": "codeowners-path" }
```

The orchestrator records this as `codeowners-path` in the registry entry. No WI-link mode (GitHub has no work-item-with-area-path concept; use Issues for that, which the consumer's `work` workflow handles separately).

## registryTemplate

After the generic header (name, path, tech, branch), the provider's block:

```markdown
| pr-platform | `github` |
| github-host | `<host>`  <!-- omit if github.com -->
| github-owner | `<owner>` |
| github-repo | `<repo>` |
| default-branch | `<defaultBranch>` |
| codeowners-path | `<path or TODO>` |
| build | `TODO` |
| coding-standards | `TODO` |
| icm-teams | `TODO`  <!-- omit if consumer does not use ICM -->
| kusto | `TODO`     <!-- omit if consumer does not use Kusto -->
```

The orchestrator may append `monorepo` and other optional rows from user input.

## mcpTools

None required. The provider uses `gh` CLI (or `Invoke-RestMethod` fallback) — both terminal-only. No `tools:` allowlist edits to the consuming prompt are needed when onboarding a GitHub repo, assuming `read`, `edit`, and `execute` are already declared.

## downstreamPromptUpdates

None unless the consumer wants `gh`-based queries directly inside agents (e.g. a `gh issue list` step in `work`). Those would be terminal commands — still no MCP allowlist edits required.
