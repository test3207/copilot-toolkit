# Generic git provider (onboard-repo)

Catch-all fallback for any git remote that does not match the `ado` or `github` providers (self-hosted GitLab without `gh` parity, Bitbucket, custom Gitea, plain SSH remotes, etc.).

This provider supplies the minimum metadata needed to mount the repo as a submodule + record it in the registry. Host-specific behavior (PR review, work items, ICM, CI links) is out of scope until a dedicated provider is authored.

## URL detection

Matches any of:

- HTTPS git URL ending in `.git`: `^https?:\/\/[^/]+\/.+\.git\/?$`
- HTTPS git URL with `/` path that looks like `owner/repo`: `^https?:\/\/[^/]+\/[^/]+\/[^/?#]+\/?$`
- SSH git URL: `^[\w.-]+@[\w.-]+:[^/]+\/[^/?#]+(\.git)?$` (e.g. `git@gitlab.example.com:team/proj.git`)

ALWAYS tried last (after `ado` and `github` reject the URL).

## Registry fields produced

This provider populates:

| Key | Source |
| --- | --- |
| `pr-platform` | Literal `generic-git`. |
| `remote-url` | `parseRepoUrl.cloneUrl`. |
| `host` | `parseRepoUrl.host`. |
| `default-branch` | `getRepoMetadata.defaultBranch`. |

All ownership / review / CI / observability fields are `TODO`.

## parseRepoUrl

Extract the longest reasonable identity from the URL:

```pwsh
$url = '<user input>'
if ($url -match '^([\w.-]+)@([\w.-]+):(.+?)(?:\.git)?\/?$') {
    # SSH form: git@host:owner/repo
    $host = $matches[2]
    $path = $matches[3]
} elseif ($url -match '^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$') {
    $host = $matches[1]
    $path = $matches[2]
}
$parts = $path -split '/'
$repoName = $parts[-1]
$org = if ($parts.Count -ge 2) { ($parts[0..($parts.Count - 2)] -join '/') } else { '' }
```

Emit:

```jsonc
{
  "host": "<host>",
  "org": "<owner / group / path-prefix>",
  "project": "",
  "repoName": "<repo>",
  "cloneUrl": "<user input verbatim>"
}
```

## getRepoMetadata

The only platform-side data needed is the default branch. Probe via `git ls-remote` (no auth assumed beyond the user's existing git credentials):

```pwsh
$head = git --no-pager ls-remote --symref '<cloneUrl>' HEAD | Select-String '^ref:' | ForEach-Object { ($_ -replace 'ref:\s+refs/heads/(\S+).*', '$1') }
# Fallback if symref unavailable: ask the user.
```

Return:

```jsonc
{ "defaultBranch": "<branch>" }
```

If `ls-remote` fails (auth required), STOP and ask the user for the default branch.

## resolveOwnership

No automated path. Return:

```jsonc
{ "kind": "none", "value": "TODO", "registryKey": "ownership-notes" }
```

Orchestrator records this as a registry TODO. Suggest in the final report that the user fill `ownership-notes` once the repo's review/escalation conventions are known.

## registryTemplate

After the generic header (name, path, tech, branch), the provider's block:

```markdown
| pr-platform | `generic-git` |
| remote-url | `<clone URL>` |
| host | `<host>` |
| default-branch | `<branch>` |
| ownership-notes | `TODO` |
| build | `TODO` |
| coding-standards | `TODO` |
```

All consumer-tool fields (PR review, work, oncall) remain `TODO` — the registry entry exists, but `/pr-review`, `/work`, and `/oncall` will refuse to run against this entry until a dedicated provider is added.

## mcpTools

None. Provider is pure git CLI.

## downstreamPromptUpdates

None. Consumer tools that require host-aware behavior (`pr-review` provider, `work` WI integration) cannot run against `generic-git` entries until a real provider is authored.
