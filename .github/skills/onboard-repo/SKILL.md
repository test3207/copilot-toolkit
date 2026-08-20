---
name: onboard-repo
description: Onboard a new repository as a git submodule with a registry entry, host-aware metadata, and downstream-prompt tool wiring. Dispatches to a VCS-host provider (ADO / GitHub / generic git) for URL parsing, repo metadata, and ownership resolution. Use when asked to onboard a repo, add a submodule, register a new repo for the toolkit, or mount an external project.
user-invocable: false
---

# Onboard Repo

Add a new repository as a git submodule with registry entry and tool integration. Host-agnostic body; VCS-host-specific recipes (URL detection, parseRepoUrl / getRepoMetadata / resolveOwnership / registryTemplate, optional `mcpTools` / `downstreamPromptUpdates`) come from a provider file under [providers/](./providers/).

## When to use this skill

- The caller says "onboard repo <url>", "add a submodule", "register this repo", or runs `/onboard-repo`.
- The caller's entry prompt has set up the MCP tool allowlist (this skill itself declares no `tools`; the consuming prompt owns the allowlist).
- The consumer has writable `workflows/registry/` directory and a `workflows/registry/index.md` to append a row to.

When NOT to use it:

- The repo is already a submodule and only needs registry-metadata edits — open `workflows/registry/<repo>.md` directly.
- The caller wants to remove or rename a submodule — that lives in a separate workflow / consumer prompt; this skill only handles initial onboarding.

## Inputs

Ask the user for:

1. **Repo URL** (required) — e.g. `https://github.com/<owner>/<repo>`, `https://<org>.visualstudio.com/<project>/_git/<repo>`, `dev.azure.com/<org>/<project>/_git/<repo>`, or `git@<host>:<group>/<repo>.git`.
2. **Tech stack** (required) — e.g. `C#`, `TypeScript`, `Python`, `Go`, `Markdown`. Free-form (registry just records it).
3. **Ownership input** — provider-dependent. ADO: an `area-path` string or a sample WI link. GitHub: nothing (auto-resolved from CODEOWNERS if present). Generic git: skipped (`TODO`).
4. **Tools to apply** — default: all shipped tools (`work`, `pr-review`, `dep`), plus any consumer-private tool the consumer names. The provider may flag some as unavailable (e.g. `work` against `generic-git`).

## Quick Reference

| Item | Value |
| ---- | ----- |
| Skill version | `v1.0` (skill conversion of onboard-repo tool v2.0) |
| Providers | [providers/ado.md](./providers/ado.md), [providers/github.md](./providers/github.md), [providers/generic-git.md](./providers/generic-git.md). Add a new file under `providers/` for new hosts; no workflow edits required. |
| Subagents | None — all steps sequential / deterministic. |
| Hand-off | Step 8 dispatches [`distill-submodule-rules`](../distill-submodule-rules/SKILL.md) to surface the submodule's own Copilot rules in the host workspace. |

## Steps

### 0. Resolve provider

Read [providers/_index.md](./providers/_index.md). Walk the dispatch list in order; first provider whose `URL detection` regex matches the user-supplied URL wins.

If no provider matches and the URL does not look like a git remote at all, STOP and ask the user for a valid URL. If the URL parses but no host-specific provider matches, fall back to `generic-git`.

Load `providers/{provider}.md`. It defines `parseRepoUrl`, `getRepoMetadata`, `resolveOwnership`, `registryTemplate`, and optional `mcpTools` / `downstreamPromptUpdates` recipes used in Steps 1-7 below.

### 1. Parse URL (provider)

Run the **parseRepoUrl** recipe. Produce the standard `repoInput` object (`host`, `org`, `project`, `repoName`, `cloneUrl`) documented in [providers/_index.md](./providers/_index.md).

### 2. Add submodule (generic)

Ask the user for the working branch (`develop`, `main`, or other) first, then run the deterministic git glue in one call (adds the submodule under `repos/<repoName>`, sets `ignore = all`, and pins the branch):

```text
node .copilot-toolkit/scripts/add-submodule.mjs --name <repoInput.repoName> --clone-url <repoInput.cloneUrl> --branch <branch>
```

Prints `{ name, path, cloneUrl, branch }`.

### 3. Get repo metadata (provider)

Run the **getRepoMetadata** recipe. Record the platform identifiers it returns (`repo-guid` for ADO, `defaultBranch` for any provider, etc.) for use in the registry entry.

If the provider declares `mcpTools` and any required tool ID is missing from the consuming prompt's `tools:` allowlist, STOP and surface the gap. The user must add the tool to the entry prompt's `tools:` list and reload before continuing.

### 4. Resolve ownership (provider)

Run the **resolveOwnership** recipe. It returns `{ kind, value, registryKey }`. If `value = "TODO"`, record it as a registry TODO and continue (do NOT block onboarding).

### 5. Create registry entry

Create `.github/prompts/workflows/registry/<repoName>.md` with:

1. **Generic header** (every entry):

   ```markdown
   # <repoName>

   | Key | Value |
   | ----- | ------- |
   | path | `repos/<repoName>` |
   | tech | `<tech stack>` |
   | branch | `<branch>` |
   ```

2. **Provider block**: insert the table rows from the provider's **registryTemplate** section verbatim (with substituted values).

3. **Optional rows** (ask user; omit if unknown): `monorepo`, `bot-identity-ids`, `pr-template`, `frameworks`.

4. **Source Paths section** (optional): if the user knows a monorepo layout, append a `## Services` table mirroring an existing entry. Otherwise skip.

### 6. Update registry index

Append a row to `.github/prompts/workflows/registry/index.md` Repos table:

```markdown
| <repoName> | `repos/<repoName>` | <tech> | <pr-platform> | <ado-repo-org-or-empty> | <ado-wi-org-or-empty> |
```

For non-ADO providers, leave the ADO columns empty (`-`).

### 7. Update consuming-prompt tool declarations (provider)

Run the provider's **downstreamPromptUpdates** recipe. For `ado`: audit the entry prompts that gate ADO MCP access (typically `work.prompt.md`, `pr-review.prompt.md`, any `oncall.prompt.md`) and append any required `{server}/<tool>` entries to their `tools:` allowlists if the new repo introduces a new ADO MCP server. For `github` / `generic-git`: no edits required.

### 8. Distill submodule rules

VS Code only auto-loads the host workspace's root `.github/copilot-instructions.md`. If the newly mounted submodule carries its own `.github/copilot-instructions.md` (or any `.github/instructions/*.instructions.md`), the host agent will NOT see those rules and may violate the submodule's red lines.

Dispatch [`distill-submodule-rules`](../distill-submodule-rules/SKILL.md) with the just-onboarded `repoName`. It writes `.github/instructions/repos-<repoName>.instructions.md` with frontmatter `applyTo: "repos/<repoName>/**"` so the submodule's hard rules auto-load whenever the agent touches a file under that path.

If the submodule has no `.github/copilot-instructions.md` and no companion instructions files, the distill skill reports "nothing to distill" and writes nothing. That is the expected outcome for repos with no agent rules; continue to Step 9.

### 9. Commit

```text
feat: onboard <repoName> submodule + registry entry (provider: <provider>)
```

Include the distilled `.github/instructions/repos-<repoName>.instructions.md` (if Step 8 produced one) in this same commit.

### 10. Report

Show:

- Submodule path + clone URL + pinned branch.
- Registry file path + which fields are TODO.
- Provider used + any provider-specific caveats (e.g. "`/work` not available for `generic-git`; author a provider first").
- Distillation output path + source-snapshot sha (or "nothing to distill" if the submodule has no agent rules).
- Suggested next steps (fill TODOs as you work in the repo).

## Rules

- Skill body is HOST-AGNOSTIC. Any VCS-host-specific recipe (URL detection, repo metadata, ownership) belongs in `providers/<name>.md`, never in the steps above.
- The consumer's entry prompt owns the `tools:` allowlist (MCP tool whitelist). This skill itself declares no `tools` — by design.
- `generic-git` is always last in the dispatch order and matches any URL that looks like a git remote.

## References

- [providers/_index.md](./providers/_index.md) — provider contract (required sections, `repoInput` shape, `resolveOwnership` shape, dispatch order, defaulting).
- [providers/ado.md](./providers/ado.md) — ADO provider (MCP primary + REST fallback; WI-or-area-path ownership).
- [providers/github.md](./providers/github.md) — GitHub provider (`gh` CLI primary; CODEOWNERS-based ownership).
- [providers/generic-git.md](./providers/generic-git.md) — fallback provider for any git remote.
- [../distill-submodule-rules/SKILL.md](../distill-submodule-rules/SKILL.md) — host-side rule distillation invoked from Step 8.
