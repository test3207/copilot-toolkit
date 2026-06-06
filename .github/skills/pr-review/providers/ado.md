# ADO provider (pr-platform: ado)

Recipes for reviewing PRs hosted on Azure DevOps (`dev.azure.com` / `<org>.visualstudio.com`).

## Registry fields required

The matched registry entry MUST include:

| Field | Example | Notes |
| --- | --- | --- |
| `repo-guid` | `<repo-guid>` | The repository GUID (NOT the name). Required for both MCP `repositoryId` and REST URLs. |
| `ado-repo-server` | `<ado-repo-server-name>` | Logical MCP server name (must match a `.vscode/mcp.json` entry). The primary path for `getPrInfo` / `getThreads` / `postComment` is MCP; REST is fallback. |
| `ado-repo` | `org: <org>, project: <project>` | Web URL needs the repo NAME, fetched from `getPrInfo`. |
| `ado-resource-guid` | `499b84ac-1321-427f-aa17-267ca6975798` | Resource ID for `az account get-access-token --resource ...`. Used by the REST fallback only. Defaults to the well-known ADO public resource GUID; override only for sovereign clouds. |

If `ado-resource-guid` is omitted, use `499b84ac-1321-427f-aa17-267ca6975798` (public ADO).

## getPrInfo

Primary path (MCP): `repo_get_pull_request_by_id` on the `{registry.ado-repo-server}` server with `repositoryId={repoGuid}`, `pullRequestId={prId}`, `includeWorkItemRefs=true`. Save the returned object to `pr-review/$prId/raw-pr.json` for downstream steps.

Fallback (terminal REST — use only if the MCP call errors out for auth / availability / parameter reason):

```pwsh
$prId = '{prId}'
$org = '{registry.ado-repo.org}'
$project = '{registry.ado-repo.project}'
$repoGuid = '{registry.repo-guid}'
$adoResourceGuid = '{registry.ado-resource-guid OR 499b84ac-1321-427f-aa17-267ca6975798}'
$token = (az account get-access-token --resource $adoResourceGuid --query accessToken -o tsv)
$pr = Invoke-RestMethod `
  -Uri "https://$org.visualstudio.com/$project/_apis/git/repositories/$repoGuid/pullRequests/$prId?includeWorkItemRefs=true&api-version=7.1" `
  -Headers @{ Authorization = "Bearer $token" }
$pr | ConvertTo-Json -Depth 6 | Set-Content "pr-review/$prId/raw-pr.json"
```

### Mapping to standard `prInfo`

| Standard field | ADO source |
| --- | --- |
| `prId` | `pullRequestId` |
| `title` | `title` |
| `description` | `description` |
| `author` | `createdBy.displayName` |
| `sourceBranch` | `sourceRefName` → strip `refs/heads/` |
| `targetBranch` | `targetRefName` → strip `refs/heads/` |
| `state` | `status` mapped: `1`→`active`, `2`→`abandoned`, `3`→`merged` (closed-without-merge is rare on ADO; treat any non-`active` as final) |
| `created` | `creationDate` |
| `reviewers` | `reviewers[*]` → `{ name: displayName, vote: vote }`. Vote values: `10`=approved, `5`=approved-with-suggestions, `0`=no-vote, `-5`=waiting, `-10`=rejected. |
| `headSha` | `lastMergeSourceCommit.commitId` (the head of the source branch as ADO sees it). **Not used by ADO `fileLinkTemplate`** but kept for parity with the standard object. |
| `additions` / `deletions` / `changedFiles` | NOT returned in the PR payload — compute from `git --no-pager diff --shortstat origin/{targetBranch}...HEAD` after Step 3 checkout. |
| `workItemRefs` | `workItemRefs[*].id` (only when `includeWorkItemRefs=true`) |
| `repoNameForLinks` | `repository.name` — the short name, NOT the GUID. The ADO web UI URL requires the name. |

### Status check pitfall

Do NOT use `lastMergeCommit` to determine merge status — it is ADO's merge-preview blob and exists even for Active PRs. Always use the `status` integer.

## getThreads

Primary path (MCP): `repo_list_pull_request_threads` on the `{registry.ado-repo-server}` server with `repositoryId={repoGuid}`, `pullRequestId={prId}`. Save the returned thread array to `pr-review/$prId/raw-threads.json`.

Fallback (terminal REST — use only if the MCP call errors out):

```pwsh
$prId = '{prId}'
$org = '{registry.ado-repo.org}'
$project = '{registry.ado-repo.project}'
$repoGuid = '{registry.repo-guid}'
$token = (az account get-access-token --resource $adoResourceGuid --query accessToken -o tsv)
$threads = Invoke-RestMethod `
  -Uri "https://$org.visualstudio.com/$project/_apis/git/repositories/$repoGuid/pullRequests/$prId/threads?api-version=7.1" `
  -Headers @{ Authorization = "Bearer $token" }
$threads.value | ConvertTo-Json -Depth 6 | Set-Content "pr-review/$prId/raw-threads.json"
```

### Filtering

- Ignore system messages — author display name typically ends with `Services.TFS` or matches a registry-listed bot identity. Consult the registry's `bot-identity-ids` if present.
- File-anchored threads have `threadContext.filePath` populated.
- Thread `status` integers: `1`=Active, `2`=Fixed, `4`=Closed (others rare).

## fileLinkTemplate

```text
https://{org}.visualstudio.com/{project}/_git/{repoNameForLinks}/pullrequest/{prId}?path=/{path}&line={startLine}&lineEnd={endLine}&lineStartColumn=1&lineEndColumn=1&type=2&lineStyle=plain&_a=files
```

Substitution rules:

- `{org}`, `{project}` — from registry; `{repoNameForLinks}`, `{prId}` — from `prInfo`. The workflow Step 5 substitutes these BEFORE passing the template to subagents.
- `{path}` — repo-relative, MUST start with `/`. URL-encode spaces (`%20`) and `#`; slashes stay literal.
- `{startLine}` — 1-based.
- `{endLine}` — 1-based. For a single-line ref, set `{endLine}` equal to `{startLine}`.
- `type=2` — right (new) side of the diff. `lineStyle=plain` — avoid sticky column highlighting.

Concrete example (placeholders only):

```text
https://<org>.visualstudio.com/<project>/_git/<repo>/pullrequest/<prId>?path=/src/Foo.cs&line=42&lineEnd=88&lineStartColumn=1&lineEndColumn=1&type=2&lineStyle=plain&_a=files
```

The post-substitution template that subagents receive looks like (with `{org}` `{project}` `{repoNameForLinks}` `{prId}` already resolved):

```text
https://<org>.visualstudio.com/<project>/_git/<repo>/pullrequest/<prId>?path=/{path}&line={startLine}&lineEnd={endLine}&lineStartColumn=1&lineEndColumn=1&type=2&lineStyle=plain&_a=files
```

## autoLinkForbiddenPatterns

ADO renders bare `#<digits>` as work-item auto-links — they resolve to random / non-existent work items in posted PR comments.

| Pattern (regex) | Auto-links to | Safe replacement |
| --- | --- | --- |
| `#\d+` | Work item with that ID | `[N]` for cross-finding refs; `Finding 5` (no `#`) for prose; `AB#<id>` for intentional org-qualified WI link; `ICM <id>` (no `#`) for incident IDs; `!<prId>` for PR refs |

Patterns that the `#\d+` regex does NOT match (intentionally — these are safe):

- Markdown headings: `# Title`, `## Section` — there is a space after `#`.
- File line anchors inside link display text: `[Foo.ts#L42](url)` — letter `L` prefix before digits.
- URL parameters: `&line=42&lineEnd=117` — no `#` preceding the digits.

## postComment

Primary path (MCP): `repo_create_pull_request_thread` on the `{registry.ado-repo-server}` server. Main agent reads `pr-review/{prId}/pr-comment.md` once and passes the content as the thread body. ALWAYS create a NEW thread (`repo_create_pull_request_thread`), never `repo_reply_to_comment`.

> Note: MCP-primary loads the `pr-comment.md` body into main-agent context. The body is typically 20-30 KB; if context pressure is already high, consider the REST fallback below (terminal-only, body never enters main-agent context) and document the choice in the run.

Fallback (terminal REST — ctx-isolated; body never enters main-agent context. Use when MCP fails for auth / tenant reason OR when ctx pressure makes the MCP path risky):

```pwsh
$prId = '{prId}'
$repoGuid = '{registry.repo-guid}'
$org = '{registry.ado-repo.org}'
$project = '{registry.ado-repo.project}'
$adoResourceGuid = '{registry.ado-resource-guid OR 499b84ac-1321-427f-aa17-267ca6975798}'
$body = (Get-Content -Raw "pr-review/$prId/pr-comment.md")
$payload = @{
    comments = @(@{ parentCommentId = 0; content = $body; commentType = 1 })
    status   = 1
} | ConvertTo-Json -Depth 5
$token = (az account get-access-token --resource $adoResourceGuid --query accessToken -o tsv)
Invoke-RestMethod `
  -Uri "https://$org.visualstudio.com/$project/_apis/git/repositories/$repoGuid/pullRequests/$prId/threads?api-version=7.1" `
  -Method POST -Body $payload -ContentType "application/json" `
  -Headers @{ Authorization = "Bearer $token" } `
  | Select-Object -Property id, status | ConvertTo-Json
```

### Tenant pitfall

ADO REST calls require the Azure AD tenant that the target org's subscription lives in. Before the REST call:

```pwsh
$expectedTenant = '<tenant-guid-for-this-org>'   # carry on the registry entry as `ado-tenant-id`
$currentTenant = (az account show --query tenantId -o tsv)
if ($currentTenant -ne $expectedTenant) {
    Write-Error "Wrong tenant ($currentTenant). Run: az account set --subscription <sub-in-target-tenant>"
}
```

Each ADO org maps to exactly one tenant; the registry's `ado-tenant-id` field carries the expected GUID per org.
