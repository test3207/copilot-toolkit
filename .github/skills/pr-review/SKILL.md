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
- The consumer has a registry entry for the repo containing a `pr-platform` field (`ado` / `github` / future hosts). If missing, default to `ado` for back-compat.

When NOT to use it:

- The caller wants to list their open PRs (that lives in the consumer's entry prompt — this skill only handles `review pr <id>`).
- The repo is not present in the consumer's registry — ask the caller to onboard it via `/onboard-repo` first.

## Inputs

- `toolkit-root` — workspace-relative path the entry prompt resolved (`.copilot-toolkit/.github` when consumed via submodule, `.github` when self-hosted in this repo). The skill threads this value to every subagent so each one can locate its `{toolkit-root}/skills/pr-review/...` references at runtime.
- `prId` — numeric PR id (already resolved by the entry prompt via `tools/parse-input.mjs`).
- `repo` — repo name as it appears in the consumer's `workflows/registry/index.md`.
- Registry metadata for that repo (loaded by the entry prompt): `path`, `targetBranch`, `pr-platform`, `repo-guid` (if ADO), coding-standards list, anti-pattern allowlist.

## Quick Reference

| Item | Value |
| ---- | ----- |
| Skill version | `v1.0` (skill conversion of pr-review tool v3.3.0) |
| Working dir | `pr-review/{prId}/sections/*.md` per-section files; `pr-review/{prId}/review.md` is the terminal-concat artifact. |
| Providers | [providers/ado.md](./providers/ado.md), [providers/github.md](./providers/github.md). Add a new file under `providers/` for new hosts; no workflow edits required. |
| Subagents | `.github/agents/pr-logic-reviewer.md` (7a) · `.github/agents/pr-impact-analyzer.md` (7b) · `.github/agents/pr-quality-checker.md` (7c) · `.github/agents/pr-finding-validator.md` (7d). |

## Input Resolution (Step 0)

Performed by the entry prompt, then handed to this skill:

1. Parse the input ID / URL via `node tools/parse-input.mjs "<input>"`.
2. Read `workflows/registry/index.md` to match the repo.
3. Read `workflows/registry/<matched-repo>.md` for full metadata.
4. Read the registry entry's `pr-platform` field (default `ado`). Load [providers/{pr-platform}.md](./providers/) — every PR-host-specific recipe (fetch, post, URL format, auto-link rules) comes from this file. The workflow body is host-agnostic.

## Workflow

The full step-by-step orchestration lives in [workflow.md](./workflow.md). The provider seam contract is in [providers/_index.md](./providers/_index.md).

**Do NOT read** [reference.md](./reference.md), [rules.md](./rules.md), or [decision.md](./decision.md) upfront. They are loaded on-demand:

- `reference.md` — read only when a workflow step says "See reference.md".
- `providers/{pr-platform}.md` — read in Step 0 (resolve provider); recipes invoked in Steps 1, 2, 5, 7, 9.1b, 9.2.
- `rules.md` — subagents read for review criteria (smell catalog, corner cases).
- `decision.md` — main agent reads in Step 8 for verdict + Action Items gates.

## Todo-Driven Execution

**BEFORE any review action, create a todo list using `manage_todo_list`.**

```
1. Read workflow.md to get steps.
2. Create todo list with ALL steps from workflow.
3. Execute steps ONE BY ONE, marking progress.
4. Never skip steps or execute without todo tracking.
```

## Review Procedure

When the entry prompt invokes this skill with `prId` + registry metadata:

1. **Resolve provider** (Step 0): match `pr-platform`, load `providers/{name}.md`.
2. Read [workflow.md](./workflow.md).
3. Create todo list with all workflow steps using `manage_todo_list`.
4. Execute each step, marking todo as in-progress → completed.
5. Each step writes its content into `pr-review/{prId}/sections/<NN-name>.md`; final `review.md` is assembled by terminal concat in Step 9.1.
6. **Post PR Comment to PR** via the provider's `postComment` recipe (Step 9.2). Use the provider's documented fallback only if the primary fails or when the provider's fallback Note flags a ctx tradeoff worth taking.
7. Return to target branch.

**Key Principle**: Checkout PR branch locally; subagents do deep analysis in their own contexts and write directly to section files. Main agent never reads source files inline; main agent never reads back full subagent payloads.

## PR Comment Rules

When posting review comments to PR:

1. **Default path = provider's `postComment` recipe** (Step 9.2 in workflow.md). Each provider picks its own primary: MCP-first for providers with an MCP server (e.g. ADO `repo_create_pull_request_thread`); CLI-first for providers without (e.g. GitHub `gh pr comment`, body piped from `pr-review/{prId}/pr-comment.md` without entering main-agent context).
2. **Fallback** — only if the primary path fails: use the provider's documented fallback (ADO: terminal REST `POST .../threads`, body never enters main-agent context; GitHub: REST `POST /issues/{n}/comments`). Always create NEW comment / thread, never reply.
3. **AI attribution header is built INTO the section template** (see [reference.md](./reference.md) → PR Comment section file template):

   ```text
   ## AI Code Review

   *Generated by GitHub Copilot (<model_name>) | pr-review <tool_version>*

   ---
   ```

   - `<model_name>`: state your exact model name as defined in your system instructions. Do not guess.
   - `<tool_version>`: from the Quick Reference table above.
4. **Post the full assembled body** — the section template concats TL;DR + Action Items + Intent + Validation (+ ICM if applicable). Do NOT condense or rewrite from memory.
5. **ICM Comment is NOT posted to PR** — it is saved in `sections/90-icm.md` for manual copy-paste.

## Rules

- Skill body and all files in this directory are HOST-AGNOSTIC. Any host-specific recipe (URL format, fetch / post, auto-link rules) belongs in `providers/<name>.md`, never in `workflow.md` / `reference.md` / `rules.md` / `decision.md`.
- Subagents under `{toolkit-root}/agents/pr-*.md` read this skill's files via `{toolkit-root}/skills/pr-review/...` paths (where `{toolkit-root}` is the path the entry prompt resolved). When moving files inside this skill, update the subagent path refs.
- The consumer's entry prompt owns the `tools:` allowlist (MCP tool whitelist). This skill itself declares no `tools` — by design.

## References

- [workflow.md](./workflow.md) — main orchestration (Steps 0-9).
- [reference.md](./reference.md) — section file templates, decision rules, review heuristics.
- [rules.md](./rules.md) — review criteria, smell catalog (subagents).
- [decision.md](./decision.md) — verdict gates + Action Items construction gates (main agent, Step 8).
- [providers/_index.md](./providers/_index.md) — provider contract spec.
- [anti-patterns/index.md](./anti-patterns/index.md) — global detection rules and group index.
