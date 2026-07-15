# Step 6–7: Intent Analysis + Subagent Dispatch

Sourced from [workflow.md](../workflow.md). Step 6 is main-agent inline; Step 7 is MANDATORY parallel subagent dispatch.

## Step 6: Intent Analysis

1. Read PR description, extract purpose + linked work items
2. Identify the problem being solved and expected behavior
3. Determine **Change Type**: Config / UI / Signature / Logic / API
4. **Anti-pattern trigger scan + language detection** (lightweight, no source-file reads): from the file list + diff stats only, decide which group files each subagent should load.
   - Core groups (concern-based, language-agnostic):
     - `IF diff changes shared function behavior/signature/defaults OR adds field to a serialized resource model -> semantic.md`
     - `IF diff changes how an identifier/name/key/path/scope is constructed AND that value crosses a boundary -> semantic.md`
     - `IF diff restructures control flow / adds guards / multiple params on shared component call -> control-flow.md`
     - `IF diff adds async ops / new enum values -> async-types.md`
   - Language packs (by changed-file extension; see `anti-patterns/index.md` -> Language Packs):
     - `IF diff has .ts/.tsx/.js/.jsx -> lang/typescript-react.md` (its KO patterns BAP-06/10/11 apply only if the diff touches `ko.computed`/`pureComputed`/`subscribe`)
     - `.cs -> lang/csharp.md`, `.py -> lang/python.md` once those packs exist (no-op until shipped)
   - **Resolution precedence**: an explicit `anti-pattern-allowlist` from the registry entry / `.github/pr-review.json` wins (registry mode, unchanged); otherwise auto-detect from the diff (derive mode). A mixed-language diff loads every matching pack.
   - **Coding-standards list**: in registry mode pass the registry `coding-standards` list through unchanged. In derive mode (no list), auto-detect the same way: `common.md` always, plus the per-language file (`typescript.md` for `.ts/.tsx/.js/.jsx`, `csharp.md` for `.cs`). Subagents prepend `{toolkit-root}/skills/coding-standards/`.

Write `pr-review/{repo}/{prId}/sections/10-intent.md`:

```markdown
## Intent & Approach

**Problem**: {one paragraph from PR description}

**Solution**: {numbered list of changes from author's description}

**Change Type**: {Config / UI / Signature / Logic / API}

**Anti-pattern groups dispatched to subagents**: {list}
```

**Do NOT** read source files in Step 6 to build per-caller / branch-equivalence tables. That work has moved into the subagents (they have their own context to spend on it).

---

## Step 7: Deep Analysis (Subagent Dispatch)

**MANDATORY**: Dispatch 7a/7b/7c via `runSubagent` in a single parallel tool-call block. Inline execution by the main agent is FORBIDDEN regardless of context pressure or PR size.

_Self-check before this step_: if your next planned tool call is `read_file` against a source file from the diff, STOP -- you are about to execute the analyses inline. Issue three `runSubagent` calls instead.

_Why unconditional_:
- **Context isolation** -- each subagent gets a fresh window; the main agent stays small enough to assemble Step 8.
- **Independent perspectives** -- 7a/7b/7c each load a different prompt + analysis bias; running inline collapses them into one perspective.
- **No small-PR exception** -- the cost is 3 dispatches; the benefit applies equally to small PRs.

**Shared subagent prompt template** (fill placeholders per subagent):

```text
You are {agentName}. Analyze PR !{prId} for {role}.

toolkit-root: {toolkit-root from main agent}                # workspace-relative path the skill's caller resolved (e.g. `.copilot-toolkit/.github` when consumed, `.github` when self-hosted). Substitute {toolkit-root} placeholders in your agent prompt with this value.
prId: {prId}
repo: {repo}                                            # repo name/key (registry match, or derived repoName in derive mode). Output dir = pr-review/{repo}/{prId}/ so same-number PRs in different repos don't collide.
fileLinkTemplate: {fileLinkTemplate from Step 5}        # Template with {path}/{startLine}/{endLine} placeholders. Substitute these per finding. Do NOT construct URLs yourself.
forbiddenAutoLinkPatterns: {forbiddenAutoLinkPatterns from Step 5}   # Regex list. Never emit text that matches these; use the safe replacements shown in the table.
Intent: {one-line from Step 6}
Change Type: {Step 6}
Repo path: pr-review-worktree/{repo}/{prId}/worktree    # isolated git worktree checked out to the PR source branch. Read/search ALL source files from here -- it reflects the PR head and reading it never disturbs the user's live tree. Do NOT read source from the host repo root. This tree is NOT ignored, so `grep_search`, `file_search`, and `semantic_search` all reach it -- scope searches to it via `includePattern` set to this path (no `includeIgnoredFiles`). Search division: grep/file/semantic search here for discovery + cross-references; `read_file` here for a changed file's full content; the exact change set is pr-review/{repo}/{prId}/diff.txt (do NOT re-run `git diff`).
Target branch: {targetBranch}
Changed files: see pr-review/{repo}/{prId}/diff.txt
Anti-pattern groups to load: {list of file paths from Step 6 scan}
Repo coding-standards: {list from registry, or language-autodetected in derive mode -- Step 6}

Output contract: WRITE full analysis to pr-review/{repo}/{prId}/sections/{file}; RETURN ONLY the compact summary your agent file specifies.
```

| Subagent | role | Section file written |
| -------- | ---- | -------------------- |
| **7a: pr-logic-reviewer** | code correctness (logic, why, corners, tests) | `20-logic.md` |
| **7b: pr-impact-analyzer** | call chain + regression risk | `30-impact.md` |
| **7c: pr-quality-checker** (Haiku 4.5) | similar code + smells | `40-quality.md` |

Each subagent returns a compact summary message. Main agent collects the 3 summaries -- nothing else. No re-reading of `content.json` blobs.

### 7d: pr-finding-validator (conditional)

1. From the 3 summaries, extract Medium+ findings (severity tag >= Medium)
2. IF none: skip to Step 8
3. Dispatch **pr-finding-validator** with: `toolkit-root` + `repo` + `prId` from main agent (so it can locate `pr-review/{repo}/{prId}/sections/`), the Medium+ findings list (with the original URL links preserved), intent summary, `fileLinkTemplate + forbiddenAutoLinkPatterns` from Step 5, paths to `20-logic.md` / `30-impact.md` / `40-quality.md`
4. Validator writes `50-validation.md`; returns per-finding verdicts
5. Apply verdicts to the in-context summaries: upgrade severities where validator says so; never downgrade
