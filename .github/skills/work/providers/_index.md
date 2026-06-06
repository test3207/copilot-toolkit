# Issue-Tracker Provider Contract

Loaded by the main `/work` agent at Step 0 after registry resolution. Picks the matching provider file under this directory based on the registry `issue-tracker` field (default: `ado`).

> The `/work` workflow body NEVER calls a tracker SDK directly. It calls the abstract operations below; each provider file maps the operation to its concrete tools (ADO MCP, `gh` CLI, etc.).

## Resolution

1. Read registry `<repo>.md` for the `issue-tracker` field. If absent, default to `ado`.
2. Load `{toolkit-root}/skills/work/providers/<issue-tracker>.md` once per session (where `{toolkit-root}` is the path the entry prompt resolved — `.copilot-toolkit/.github` when consumed, `.github` when self-hosted).
3. All subsequent operations in `feature.md` / `bugfix.md` / `shared.md` resolve via the loaded provider.

If the field value has no matching file: STOP and surface the error to the user (do NOT silently fall back).

## Required operations (Minimal contract)

Every provider MUST implement all eight operations. Provider files render each as a labeled section with the exact concrete recipe.

| Operation | Inputs | Returns | Used by |
| --------- | ------ | ------- | ------- |
| `parseItemUrl` | URL string | `{ id, providerHint }` or `null` | `tools/parse-input.mjs` extension hint; Step 0 input resolution |
| `getItem` | item id | `{ id, title, body, type, parentId?, attachments[], comments[] }` | `feature.md` Step 1; `bugfix.md` Step 1 |
| `createItem` | `{ type, title, body, parentId? }` | `{ id, url }` | `feature.md` Step 1 (no-WI branch); `shared.md` Feature Gating (lifecycle item) |
| `addChildren` | `parentId`, `[{ title, body }]` | `[id, ...]` | `feature.md` Step 3 Split |
| `addComment` | item id, body | void | status updates |
| `linkPR` | item id, PR url | void | `shared.md` PR step |
| `commitMessageSuffix` | item id | suffix string appended to commit subject | `shared.md` PR step |
| `prDescriptionLink` | item id | markdown line for PR description | `shared.md` PR step |

### Type vocabulary

The workflow body uses two abstract types:

| Abstract | ADO concrete | GitHub concrete |
| -------- | ------------ | ---------------- |
| `feature` | `Deliverable` | `Issue` with label `feature` (or consumer-configured) |
| `bug` | `Bug` | `Issue` with label `bug` (or consumer-configured) |

Providers MUST map abstract → concrete in `getItem` (`type` field) and accept abstract values in `createItem`.

### Parent / child semantics

`parentId` and `addChildren` cover hierarchical work breakdown. Providers that do not have native hierarchy (e.g. GitHub Issues without sub-issues feature) MUST document the closest substitute (task-list checkbox in parent body, label convention, etc.) and implement `addChildren` accordingly — the workflow body trusts the abstraction.

## Standard registry shape

The workflow expects these registry fields per entry. Provider files MAY add provider-specific fields but MUST NOT remove these.

| Field | Required | Notes |
| ----- | -------- | ----- |
| `issue-tracker` | no | `ado` \| `github` \| custom; default `ado` |
| `incident-source` | no | optional path to a consumer-owned incident-fetch instruction file (see [Incident-source plugin slot](#incident-source-plugin-slot)) |

ADO-specific registry fields (`ado-wi-server`, `ado-wi`, `area-path`, `default-parent-wi`, etc.) live in `providers/ado.md`'s Registry section. GitHub-specific fields likewise in `providers/github.md`.

## Incident-source plugin slot

`/work bugfix` Step 1 ("Gather Information") supports an optional plugin: when registry has `incident-source: <path>`, the main agent loads that file in addition to fetching the tracked item.

Contract for an incident-source file (consumer-owned, never authored upstream):

- Path is registry-relative; the file lives under the consumer's own `.github/prompts/workflows/` (e.g. `workflows/incident/icm.md`, `workflows/incident/opsgenie.md`).
- The file MUST be a short instruction set telling the main agent how to fetch incident context (which MCP tool / CLI / URL pattern, which fields to extract, how to relate to the tracked item).
- The workflow body remains incident-system-agnostic. Adding a new internal incident system = drop a new file under the consumer's workflows + reference it in registry. No upstream toolkit change required.

If registry does NOT declare `incident-source`, Step 1 proceeds with only the tracked-item fetch + any context the user pasted.

## Available providers

| Value | File | Notes |
| ----- | ---- | ----- |
| `ado` | [ado.md](ado.md) | Azure DevOps Work Items via the ADO MCP server(s) declared in registry. Default. |
| `github` | [github.md](github.md) | GitHub Issues via `gh` CLI. |

To add a new provider: author `providers/<name>.md` implementing all eight operations and add a row above. Workflow body changes are NOT required.
