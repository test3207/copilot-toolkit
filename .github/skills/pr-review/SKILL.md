---
name: pr-review
description: Review a pull request for code quality, corner cases, regression risk, and host-specific anti-patterns. Dispatches three parallel review subagents (logic, impact, quality), validates Medium+ findings, assembles a sectioned review.md + a curated PR comment, and posts the comment via the matched provider (ADO / GitHub). Use when asked to review a PR, check a PR for issues, or analyze a pull request before merge.
user-invocable: false
---

# PR Review

Review a pull request end-to-end. Host-agnostic body; PR-host-specific recipes (URL format, fetch / post, auto-link rules) come from a provider file under [providers/](./providers/).

## When to use this skill

- The caller says "review pr <id>", "review this PR", "check PR !123", etc.
- The caller's entry prompt has set up the MCP tool allowlist (this skill itself declares no `tools`; the consuming prompt owns the allowlist).
- The repo context resolves either way: a registry entry matched it (**registry mode**), OR the entry prompt derived it from the git remote + optional `.github/pr-review.json` (**derive mode**). Both yield a `repoContext` with a `pr-platform` field (defaults to `ado` for back-compat).

When NOT to use it:

- The caller wants to list their open PRs (that lives in the consumer's entry prompt — this skill only handles `review pr <id>`).
- Neither resolution path produced a repo context — the git remote host is unsupported (`platform == unknown`) AND no registry entry / `.github/pr-review.json` exists. Ask the caller to add one.

## Inputs

- `toolkit-root` — workspace-relative path the entry prompt resolved (`.copilot-toolkit/.github` when consumed via submodule, `.github` when self-hosted in this repo). The skill threads this value to every subagent so each one can locate its `{toolkit-root}/skills/pr-review/...` references at runtime.
- `prId` — numeric PR id (already resolved by the entry prompt via `.copilot-toolkit/scripts/parse-input.mjs`).
- `repo` — repo name (from the matched registry entry in registry mode, or `repoName` from the derived git remote in derive mode).
- `repoContext` — the metadata bundle the entry prompt resolved, identical shape in both modes: `path`, `targetBranch`, `pr-platform`, `ado-repo-server` + `repo-guid` (if ADO), coding-standards list (registry list, or language-autodetected in derive mode), anti-pattern allowlist. See [Input Resolution (Step 0)](#input-resolution-step-0) for how each field is filled.

## Quick Reference

| Item | Value |
| ---- | ----- |
| Tool name | `pr-review` |
| Tool version | `v3.5.0` |
| Working dir | `pr-review/{repo}/{prId}/sections/*.md` per-section files; `pr-review/{repo}/{prId}/review.md` is the terminal-concat artifact; the persisted diff is `pr-review/{repo}/{prId}/diff.txt`. The PR source branch is checked out into an isolated worktree at `pr-review/{repo}/{prId}/worktree/` (Step 3), so reviews never mutate the user's working tree and multiple reviews can run in parallel in the same repo. All output lives under `pr-review/`, which the skill self-ignores via a generated `pr-review/.gitignore` (`*`) on first run -- portable, needs no consumer root `.gitignore` or sync. |
| Providers | [providers/ado.md](./providers/ado.md), [providers/github.md](./providers/github.md). Add a new file under `providers/` for new hosts; no workflow edits required. |
| Subagents | `.github/agents/pr-logic-reviewer.md` (7a) · `.github/agents/pr-impact-analyzer.md` (7b) · `.github/agents/pr-quality-checker.md` (7c) · `.github/agents/pr-finding-validator.md` (7d). |

## Input Resolution (Step 0)

Performed by the entry prompt, then handed to this skill. Two modes, one output shape (`repoContext`):

1. Parse the input ID / URL via `node .copilot-toolkit/scripts/parse-input.mjs "<input>"`.
2. **Registry-first**: read `workflows/registry/index.md` and try to match the repo. If matched, read `workflows/registry/<matched-repo>.md` for full metadata → `repoContext` (registry mode; unchanged behavior).
3. **Derive-fallback** (only when no registry index exists, or no entry matches): build `repoContext` at runtime — `node .copilot-toolkit/scripts/derive-repo-context.mjs "$(git --no-pager remote get-url origin)"` for `{ platform, org/project/repoName | owner/repoName }`; `path = .`; merge any [`.github/pr-review.json`](#optional-githubpr-reviewjson) fields; auto-detect coding-standards / anti-pattern language packs from the diff (see [steps/analyze.md](./steps/analyze.md) Step 6). If `platform == unknown` and no config file supplies one, STOP.
4. Read `repoContext.pr-platform` (default `ado`). Load [providers/{pr-platform}.md](./providers/) — every PR-host-specific recipe (fetch, post, URL format, auto-link rules) comes from this file. The workflow body is host-agnostic.
5. **Preflight + access method**: run `node .copilot-toolkit/scripts/preflight.mjs --platform {pr-platform} --mcp-configured <ado-repo-server present?>`. Resolve the provider access method (`ado-access` / `gh-access`) = `.github/pr-review.json` override else the report's `access.recommended`. A missing hard dep (node / git, or the platform credential `az`/`gh`) STOPS with remediation -- there is no offline mode. See [providers/{pr-platform}.md](./providers/) → `accessMethods`.

## Optional `.github/pr-review.json`

A consumer-owned file at the **reviewed repo's** root, used only in derive mode to supply the bits a git remote cannot reveal (and to override derived defaults). All fields optional; absent file = pure derivation + defaults. Registry mode ignores it (the registry entry wins).

```jsonc
{
  "pr-platform": "ado",            // override the derived platform if needed
  "ado-repo-server": "ado-1",      // MCP logical server name for ADO repo ops (not derivable)
  "ado-access": "auto",            // auto|mcp|rest (GitHub: gh-access auto|cli|rest) — override the preflight-resolved access method
  "repo-guid": "<guid>",            // skip the REST "get repo by name" lookup if known
  "resource-guid": "<guid>",        // sovereign-cloud resource id (not derivable)
  "tenant": "<tenant-guid>",        // sovereign-cloud tenant (not derivable)
  "target-branch": "main",          // override; normally taken from the PR object
  "coding-standards": ["common.md", "typescript.md"],  // override language autodetect
  "anti-pattern-allowlist": ["semantic.md", "control-flow.md"],  // restrict groups
  "pr-template": ".github/pull_request_template.md"   // enable template checks
}
```

Any present field augments/overrides the corresponding derived value. The schema mirrors the registry entry keys so registry mode and derive mode stay interchangeable.

## Workflow

Orchestration entry point is [workflow.md](./workflow.md); it indexes three step files under [steps/](./steps/) (`prep.md` Steps 0–5, `analyze.md` Steps 6–7, `finalize.md` Steps 8–9). The provider seam contract is in [providers/_index.md](./providers/_index.md).

**Do NOT read** [reference.md](./reference.md), [rules.md](./rules.md), or [decision.md](./decision.md) upfront. They are loaded on-demand:

- `reference.md` — read only when a workflow step says "See reference.md".
- `providers/{pr-platform}.md` — read in Step 0 (resolve provider); recipes invoked in Steps 1, 2, 5, 7, 9.1b, 9.2.
- `rules.md` — subagents read for review criteria (smell catalog, corner cases).
- `decision.md` — main agent reads in Step 8 for verdict + Action Items gates.

## Todo-Driven Execution

**BEFORE any review action, create a todo list using `manage_todo_list`.**

```
1. Read workflow.md to get the orchestrator + step file index.
2. Create todo list with ALL steps 0–9 from the Flow Summary (one todo per step / sub-step).
3. Before each step's todo, read the matching step file (steps/prep.md / steps/analyze.md / steps/finalize.md) if not yet loaded.
4. Execute steps ONE BY ONE, marking progress.
5. Never skip steps or execute without todo tracking.
```

**Key Principle**: Check out the PR source branch into an isolated git worktree (parallel-safe; never touches the user's working tree); subagents do deep analysis in their own contexts and write directly to section files. Main agent never reads source files inline; main agent never reads back full subagent payloads.

## PR Comment Rules

When posting review comments to PR:

1. **Default path = provider's `postComment` recipe** (Step 9.2 in workflow.md). Each provider picks its own primary: MCP-first for providers with an MCP server (e.g. ADO `repo_create_pull_request_thread`); CLI-first for providers without (e.g. GitHub `gh pr comment`, body piped from `pr-review/{repo}/{prId}/pr-comment.md` without entering main-agent context).
2. **Fallback** — only if the primary path fails: use the provider's documented fallback (ADO: terminal REST `POST .../threads`, body never enters main-agent context; GitHub: REST `POST /issues/{n}/comments`). Always create NEW comment / thread, never reply.
3. **AI attribution header is built INTO the section template** (see [reference.md](./reference.md) → PR Comment section file template):

   ```text
   ## AI Code Review

   *Generated by GitHub Copilot (<model_name>) | <tool_name> <tool_version>*

   ---
   ```

   - `<model_name>`: state your exact model name as defined in your system instructions. Do not guess.
   - `<tool_name>`: the **Tool name** value from the Quick Reference table above (currently `pr-review`). Use exactly that string.
   - `<tool_version>`: the **Tool version** value from the Quick Reference table above (currently `v3.5.0`). Use exactly that string -- do not substitute a different version.
4. **Post the full assembled body** — the section template concats TL;DR + Action Items + Intent + Validation (+ ICM if applicable). Do NOT condense or rewrite from memory.
5. **ICM Comment is NOT posted to PR** — it is saved in `sections/90-icm.md` for manual copy-paste.

## Rules

- Skill body and all files in this directory are HOST-AGNOSTIC. Any host-specific recipe (URL format, fetch / post, auto-link rules) belongs in `providers/<name>.md`, never in `workflow.md` / `reference.md` / `rules.md` / `decision.md`.
- Subagents under `{toolkit-root}/agents/pr-*.md` read this skill's files via `{toolkit-root}/skills/pr-review/...` paths (where `{toolkit-root}` is the path the entry prompt resolved). When moving files inside this skill, update the subagent path refs.
- The consumer's entry prompt owns the `tools:` allowlist (MCP tool whitelist). This skill itself declares no `tools` — by design.

## References

- [workflow.md](./workflow.md) — main orchestrator (intro + section-file model + Rules + step file index + Anti-Summarization Rule + Flow Summary).
- [steps/prep.md](./steps/prep.md) — Steps 0–5 (provider, fetch, section scaffolding).
- [steps/analyze.md](./steps/analyze.md) — Steps 6–7 (intent + MANDATORY parallel subagent dispatch).
- [steps/finalize.md](./steps/finalize.md) — Steps 8–9 (verdict, assemble, post).
- [reference.md](./reference.md) — section file templates, decision rules, review heuristics.
- [rules.md](./rules.md) — review criteria, smell catalog (subagents).
- [decision.md](./decision.md) — verdict gates + Action Items construction gates (main agent, Step 8).
- [providers/_index.md](./providers/_index.md) — provider contract spec.
- [anti-patterns/index.md](./anti-patterns/index.md) — global detection rules and group index.
