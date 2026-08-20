# ADO provider (onboard-repo)

Recipes for onboarding a repository hosted on Azure DevOps (`dev.azure.com` or `<org>.visualstudio.com`).

## URL detection

```regex
^https?:\/\/(?<org>[^./]+)\.visualstudio\.com\/(?:DefaultCollection\/)?(?<project>[^/]+)\/_git\/(?<repo>[^/?#]+)
^https?:\/\/dev\.azure\.com\/(?<org>[^/]+)\/(?<project>[^/]+)\/_git\/(?<repo>[^/?#]+)
```

Either regex matches → `provider = ado`.

## Registry fields produced

This provider populates:

| Key | Source |
| --- | --- |
| `pr-platform` | Literal `ado`. |
| `repo-guid` | `getRepoMetadata`. |
| `ado-repo-server` | Resolved from `org` (see Server matrix below). |
| `ado-repo` | `org: <org>, project: <project>` from `parseRepoUrl`. |
| `ado-wi-server` | Default to `ado-repo-server`; user may override if work items live in a different ADO org. |
| `ado-wi` | Default to `ado-repo`; user may override per above. |
| `area-path` | `resolveOwnership` (from WI link or direct input). |

Provider does NOT set: `build`, `frameworks`, `coding-standards`, `icm-teams`, `kusto`, `bot-identity-ids`, `feature-gating`, `pr-template`. Those are marked `TODO` by the orchestrator's generic step.

### Server matrix

The orchestrator MUST map the parsed `org` to a logical MCP server name that the consumer has configured in `.vscode/mcp.json`. Each consumer maintains its own org -> server mapping (no defaults shipped upstream). If the parsed `org` is not in the consumer's mapping, ask the user; if a new MCP server must be added to `.vscode/mcp.json`, do that first and surface the new server name.

## parseRepoUrl

Apply either `URL detection` regex; emit:

```jsonc
{
  "host": "<dev.azure.com or {org}.visualstudio.com>",
  "org": "<org>",
  "project": "<project>",
  "repoName": "<repo>",
  "cloneUrl": "https://<host>/<org-or-DefaultCollection-path>/<project>/_git/<repo>"
}
```

Use the **same URL form** the user pasted for `cloneUrl` (do not rewrite `dev.azure.com` ↔ `*.visualstudio.com`) so the submodule remote matches their existing checkouts.

## getRepoMetadata

Primary path (MCP — the prompt's `tools:` allowlist must contain the matching server's `repo_get_repo_by_name_or_id`):

```text
{ado-repo-server}/repo_get_repo_by_name_or_id  project=<project>  repositoryNameOrId=<repoName>
```

Return values used by the registry entry:

| Standard field | ADO source |
| --- | --- |
| `repo-guid` | `id` (the GUID) |
| `defaultBranch` | `defaultBranch` → strip `refs/heads/` |

Fallback (REST when MCP unavailable) — the tested helper wraps the `az` token + REST call:

```text
node .copilot-toolkit/scripts/ado-rest.mjs get-repo --org <org> --project <project> --repo-name <repoName>
```

Prints `{ id, name, defaultBranch }` (`id` = the `repo-guid`). For sovereign clouds add `--resource-guid <ado-resource-guid>`.

## resolveOwnership

ADO ownership = `System.AreaPath` on a representative work item.

Two input modes:

1. **User pastes a WI link**: extract WI id via `node .copilot-toolkit/scripts/parse-input.mjs "<link>"` (returns `{ type: "wi", id, org, project }`). Fetch the WI:

   ```text
   {ado-wi-server}/wit_get_work_item  id=<wiId>
   ```

   Read `fields["System.AreaPath"]`.

2. **User pastes a raw area-path string** (e.g. `OS\Core\CMD\AVD\Management`): use directly.

Return:

```jsonc
{
  "kind": "area-path",
  "value": "<resolved or raw area-path>",
  "registryKey": "area-path"
}
```

If neither is supplied, return `value = "TODO"` and prompt user to fill the registry entry later.

## registryTemplate

After the generic header (name, path, tech, branch), the provider's block:

```markdown
| pr-platform | `ado` |
| repo-guid | `<guid>` |
| ado-repo-server | `<server-name>` |
| ado-repo | org: `<org>`, project: `<project>` |
| ado-wi-server | `<server-name>` |
| ado-wi | org: `<org>`, project: `<project>` |
| area-path | `<area-path or TODO>` |
| build | `TODO` |
| coding-standards | `TODO` |
| feature-gating | `TODO` |
| icm-teams | `TODO` |
| kusto | `TODO` |
```

The orchestrator may append `monorepo`, `bot-identity-ids`, and other optional rows from user input.

## mcpTools

The consuming prompt's `tools:` allowlist MUST contain, for each ADO server entry the consumer has configured in `.vscode/mcp.json`:

- `<ado-repo-server>/repo_get_repo_by_name_or_id` — for repo metadata fetch
- `<ado-wi-server>/wit_get_work_item` — for WI-link-based area-path resolution

List one allowlist entry per server name actually used (do NOT wildcard with `<ado-repo-server>/*`).

If onboarding a repo from a new ADO org whose MCP server is not yet in `.vscode/mcp.json`:

1. Add the server entry to `.vscode/mcp.json` (see `Server matrix` above for naming convention).
2. Add the new `{server}/repo_get_repo_by_name_or_id` entry to the prompt's `tools:` allowlist.
3. Reload window so the new server / tool registers before continuing onboarding.

## downstreamPromptUpdates

After onboarding, audit the consuming prompts (`work.prompt.md`, `pr-review.prompt.md`, and any consumer-private prompt such as an `oncall.prompt.md`) for ADO MCP allowlist entries. If the new repo uses an ADO server that those prompts don't already declare, append the required `{server}/<tool>` entries to their `tools:` lists. No edit needed if the new repo uses the same servers as an already-onboarded repo.
