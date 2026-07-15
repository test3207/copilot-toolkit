# ADO provider (pr-platform: ado)

Recipes for reviewing PRs hosted on Azure DevOps (`dev.azure.com` / `<org>.visualstudio.com`).

## Registry fields required

The `repoContext` (from a matched registry entry, OR derived in derive mode) MUST resolve these:

| Field | Example | Notes |
| --- | --- | --- |
| `repo-guid` | `<repo-guid>` | The repository GUID (NOT the name). Required for both MCP `repositoryId` and REST URLs. In **derive mode** it is not in the git remote — resolve it once from `repoName` (see *Resolving repo identity in derive mode* below). |
| `ado-repo-server` | `<ado-repo-server-name>` | Logical MCP server name (must match a `.vscode/mcp.json` entry). The primary path for `getPrInfo` / `getThreads` / `postComment` is MCP; REST is fallback. In derive mode, read from `.github/pr-review.json`; else default to the first ADO MCP server in the allowlist. |
| `ado-repo` | `org: <org>, project: <project>` | Web URL needs the repo NAME, fetched from `getPrInfo`. In derive mode, `org`/`project` come from the derived git remote. |
| `ado-resource-guid` | `499b84ac-1321-427f-aa17-267ca6975798` | Resource ID for `az account get-access-token --resource ...`. Used by the REST fallback only. Defaults to the well-known ADO public resource GUID; override only for sovereign clouds (registry `ado-resource-guid` or `.github/pr-review.json` `resource-guid`). |

If `ado-resource-guid` is omitted, use `499b84ac-1321-427f-aa17-267ca6975798` (public ADO).

### Resolving repo identity in derive mode

When there is no registry entry and `.github/pr-review.json` did not supply `repo-guid`, resolve it once before `getPrInfo`:

- Primary (MCP): `repo_get_repo_by_name_or_id` on the `{ado-repo-server}` server with `project={project}`, `repositoryNameOrId={repoName}` → take `.id` as `repoGuid` and `.name` as `repoNameForLinks`.
- Fallback / `rest` transport: `node .copilot-toolkit/scripts/ado-rest.mjs get-repo --org {org} --project {project} --repo-name {repoName}` → prints `{ id, name, defaultBranch }`; take `.id` as `repoGuid`, `.name` as `repoNameForLinks`.

In registry mode this step is skipped (the entry already carries `repo-guid`).

## accessMethods

`ado-access` (a `repoContext` field; default `auto`) selects how this provider talks to ADO. Workflow Step 0 resolves it after running the preflight doctor (`scripts/preflight.mjs --platform ado --mcp-configured <true|false>`).

An authenticated `az` is **required** for ADO review -- the `rest` transport uses its bearer token, and the `mcp` server's `azure-identity` auth relies on the same sign-in. If `az` is missing or not signed in, preflight reports it as `blocking` and Step 0 STOPS with remediation. **There is no offline mode.**

| Method | Selected when | Transport |
| --- | --- | --- |
| `mcp` | `ado-repo-server` is configured (registry entry or `.github/pr-review.json`) AND that server is in the tool allowlist | `repo_*` MCP tools on `{ado-repo-server}` |
| `rest` | no MCP server configured | `az` bearer token + ADO REST (`https://{org}.visualstudio.com/...`) |

`auto` resolution order: `mcp` -> `rest` (first match wins; both require `az` signed in). An explicit `.github/pr-review.json` `ado-access` value overrides the auto choice. Registry mode keeps `ado-repo-server`, so it always resolves to `mcp` (behavior unchanged).

**Per-operation transport**: each op below documents an MCP recipe and a terminal-REST recipe. `mcp` runs the MCP recipe; `rest` runs the REST recipe (a first-class path, not a last-resort fallback). When `ado-access = mcp` and an MCP call fails for an auth / availability reason, fall through to that op's REST recipe for the single call.

**Cross-org**: `rest` takes `{org}` from `repoContext` on every call, so one signed-in `az` reviews PRs across any org whose tenant that identity can reach. `mcp` is pinned to its server's launch org (cross-org needs one server per org). See the Tenant pitfall under `postComment`: each org maps to one AAD tenant; if `az` is signed into the wrong tenant the REST call returns 203/401 -- re-run `az login --tenant <id>` (the preflight reports the current `deps.az.tenantId`).

## getPrInfo

Primary path (MCP): `repo_get_pull_request_by_id` on the `{registry.ado-repo-server}` server with `repositoryId={repoGuid}`, `pullRequestId={prId}`, `includeWorkItemRefs=true`. Save the returned object to `pr-review/$repo/$prId/raw-pr.json` for downstream steps.

Fallback / `rest` transport (ctx-isolated — the payload never enters main-agent context):

`node .copilot-toolkit/scripts/ado-rest.mjs get-pr --org {org} --project {project} --repo-guid {repo-guid} --pr-id {prId} --out pr-review/{repo}/{prId}/raw-pr.json` — saves the PR object. For sovereign clouds add `--resource-guid {ado-resource-guid}`.

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
| `additions` / `deletions` / `changedFiles` | NOT returned in the PR payload — compute from `git -C pr-review/{repo}/{prId}/worktree --no-pager diff --shortstat origin/{targetBranch}...HEAD` against the Step 3 worktree (the host tree's HEAD is unchanged under the worktree model, so run it via `git -C` on the worktree). |
| `workItemRefs` | `workItemRefs[*].id` (only when `includeWorkItemRefs=true`) |
| `repoNameForLinks` | `repository.name` — the short name, NOT the GUID. The ADO web UI URL requires the name. |

### Status check pitfall

Do NOT use `lastMergeCommit` to determine merge status — it is ADO's merge-preview blob and exists even for Active PRs. Always use the `status` integer.

## getThreads

Primary path (MCP): `repo_list_pull_request_threads` on the `{registry.ado-repo-server}` server with `repositoryId={repoGuid}`, `pullRequestId={prId}`. Save the returned thread array to `pr-review/$repo/$prId/raw-threads.json`.

Fallback / `rest` transport:

`node .copilot-toolkit/scripts/ado-rest.mjs get-threads --org {org} --project {project} --repo-guid {repo-guid} --pr-id {prId} --out pr-review/{repo}/{prId}/raw-threads.json` — saves the thread array (already unwrapped from `.value`).

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

Primary path (MCP): `repo_create_pull_request_thread` on the `{registry.ado-repo-server}` server. Main agent reads `pr-review/{repo}/{prId}/pr-comment.md` once and passes the content as the thread body. ALWAYS create a NEW thread (`repo_create_pull_request_thread`), never `repo_reply_to_comment`.

> Note: MCP-primary loads the `pr-comment.md` body into main-agent context. The body is typically 20-30 KB; if context pressure is already high, consider the REST fallback below (terminal-only, body never enters main-agent context) and document the choice in the run.

Fallback / `rest` transport (ctx-isolated — the body never enters main-agent context):

`node .copilot-toolkit/scripts/ado-rest.mjs post-comment --org {org} --project {project} --repo-guid {repo-guid} --pr-id {prId} --body-file pr-review/{repo}/{prId}/pr-comment.md` — creates a NEW thread and prints `{ threadId, status, commentId }`. For sovereign clouds add `--resource-guid {ado-resource-guid}`.

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
