# Provider: ADO (Azure DevOps Work Items)

Concrete implementation of the issue-tracker contract for Azure DevOps. Default provider when registry omits `issue-tracker`.

## What the toolkit does not guarantee

Every operation in this file is an MCP call, and the toolkit ships no MCP wiring
and no `tools:` entries for one. These tools reach the agent only if the consumer
has added them to **their own copy** of `work.prompt.md`. There is no REST
fallback for work-item operations: `scripts/ado-rest.mjs` covers repo and PR
reads plus comment posting, nothing on the work-item side.

So: if a required tool is unavailable, STOP and name the missing tool. Never
continue on a tracked item that was not fetched.

## Required registry fields

| Field | Notes |
| ----- | ----- |
| `ado-wi-server` | MCP server name to use for WI calls (e.g. `ado-microsoft`) |
| `ado-wi.org`, `ado-wi.project` | Org + project for WI ops |
| `area-path` | Used to match WI back to repo during input resolution |
| `default-parent-wi` | (optional) parent WI id used when `createItem(parent=null, type=feature)` and user does not supply one |
| `ado-repo-server` | MCP server name for PR ops (used by `linkPR` to decide cross-org behavior) |

## Operations

### `parseItemUrl(url)`

Match patterns:

- `https://<org>.visualstudio.com/<project>/_workitems/edit/<id>`
- `https://dev.azure.com/<org>/<project>/_workitems/edit/<id>`

Return `{ id, providerHint: "ado", org, project }`. Otherwise `null`.

`.copilot-toolkit/scripts/parse-input.mjs` already covers these patterns and returns `type: "wi"`; treat that as the ADO provider hint. (Note: a GitHub issue URL also returns `type: "wi"` -- provider selection is registry-driven via the `issue-tracker` field, so `type: "wi"` alone does NOT imply ADO; this hint applies only once the registry has selected the ADO provider.)

### `getItem(id)`

```text
wit_get_work_item(id, project=<ado-wi.project>, expand="relations")
wit_list_work_item_comments(id, project=<ado-wi.project>)
```

Map response:

| Abstract field | ADO source |
| -------------- | ---------- |
| `title` | `fields["System.Title"]` |
| `body` | `fields["System.Description"]` (HTML) + `fields["Microsoft.VSTS.TCM.ReproSteps"]` (Bug only) |
| `type` | `fields["System.WorkItemType"]` → `Deliverable` ⇒ `feature`, `Bug` ⇒ `bug`, others passthrough |
| `parentId` | from `relations` where `rel == "System.LinkTypes.Hierarchy-Reverse"` |
| `attachments` | from `relations` where `rel == "AttachedFile"` — list `url + name` |
| `comments` | from `wit_list_work_item_comments` |

### `createItem({ type, title, body, parentId? })`

```text
wit_create_work_item(
  project=<ado-wi.project>,
  type=<map abstract: feature→Deliverable, bug→Bug>,
  fields={
    "System.Title": title,
    "System.Description": body,           # HTML for Deliverable
    "Microsoft.VSTS.TCM.ReproSteps": body # HTML for Bug
  },
  parentId=parentId or <default-parent-wi if type=feature and parent omitted>
)
```

Returns `{ id, url: fields["System.WorkItemLink"] or constructed }`.

### `addChildren(parentId, items[])`

```text
wit_add_child_work_items(parentId, [{ title, type, body, ... }, ...])
```

Returns array of created child ids.

### `addComment(id, body)`

```text
wit_add_work_item_comment(id, project=<ado-wi.project>, body=body)
```

### `linkPR(itemId, prUrl)`

- IF `ado-repo-server == ado-wi-server` (same org): link via MCP `wit_link_work_item_to_pull_request(itemId, prUrl)`.
- ELSE (cross-org — repo and WI live in different ADO orgs / tenants): do NOT call the MCP; paste `prUrl` into the WI description manually (one comment via `addComment`) and paste the WI URL into the PR description.

### `commitMessageSuffix(itemId)`

Return `(WI-<itemId>)`.

### `prDescriptionLink(itemId)`

Return markdown like:

```markdown
- Work Item: [<itemId>](https://dev.azure.com/<ado-wi.org>/<ado-wi.project>/_workitems/edit/<itemId>)
```

(Use `<org>.visualstudio.com` form if the consumer's other URLs already use it; either resolves.)

## Area-path matching (Step 0)

Used by the main agent during input resolution to associate a WI with a registered repo:

1. From `wit_get_work_item(..., expand="relations")`, read `fields["System.AreaPath"]`.
2. Match the area path against each registry entry's `area-path` value (longest-prefix wins).
3. IF no match: ask the user which repo to use.

## Cross-org gotcha

If the consumer's repo lives in a different ADO org than the WI:

- Two MCP servers must be configured (`ado-repo-server` for the repo, `ado-wi-server` for the WI).
- `linkPR` cannot use the MCP relation (cross-tenant boundary); fall back to manual cross-paste as described above.
- If your consumer hits a cross-org shape not yet documented here, capture the registry shape in a comment so future readers don't re-discover it.
