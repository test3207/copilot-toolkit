#!/usr/bin/env node
// pr-review-assemble.mjs -- deterministic OUTPUT-tree glue for pr-review (Steps 5, 9.1, 9.1b, provider comment).
//
// The review workflow produces its artifacts under the self-ignored pr-review/{repo}/{prId}/ tree:
// per-section files, the concatenated review.md, and the curated pr-comment.md. Building and
// verifying those is deterministic multi-step glue (glob + sort + trim + join + regex gate) -- exactly
// the "recipe glue = Node script, not inline shell" rule -- so it lives here instead of inline pwsh.
// LLM judgment (what to write in a section, how to fix a flagged link) stays in the markdown workflow.
//
// All paths resolve from the node process cwd (= workspace root), matching pr-review-worktree.mjs.
// Reads that carry host/agent-provided strings (model name, provider link patterns) take a JSON file
// path, never a CLI string, so a value with spaces/parens/regex never hits shell quoting.
//
// Usage:
//   init    --repo <name> --pr-id <id>                          # Step 5: create + clean sections/
//   review  --repo <name> --pr-id <id>                          # Step 9.1: concat sections/*.md -> review.md
//   comment --repo <name> --pr-id <id> --meta <json-file>       # provider: build curated pr-comment.md
//   lint    --repo <name> --pr-id <id> [--patterns <json-file>] # Step 9.1b: HARD GATE before posting
//
// --meta json:     { "model": "...", "tool": "pr-review", "version": "v3.6.3",
//                    "verdict": "Approve with Comments",    // optional; else parsed from 05-tldr.md's **Verdict: ...**
//                    "collapse": ["intent","validation"], // optional; omit = collapse ALL present curated sections; [] = render flat (no <details>)
//                    "wrap": true }                          // optional; outer whole-comment <details open> (one togglable block per review round); default true
// --patterns json: [ { "pattern": "<regex>", "autoLinksTo": "...", "safeReplacement": "..." }, ... ]
//
// stdout = one JSON object. Exit: 0 = ok; 1 = usage/precondition error; 3 = lint found violations (STOP).

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function fail(code, message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(code);
}

const command = process.argv[2];
const repo = arg('--repo');
const prId = arg('--pr-id');

if (!command || !['init', 'review', 'comment', 'lint'].includes(command)) {
  fail(1, 'first arg must be "init", "review", "comment", or "lint"');
}
if (!repo || !prId) {
  fail(1, '--repo and --pr-id are required');
}

const base = resolve(process.cwd(), 'pr-review', repo, prId);
const sectionsDir = join(base, 'sections');

// Get-Content -Raw then TrimEnd("`r","`n") -- strip only trailing CR/LF, keep inner content.
function readTrim(p) {
  return readFileSync(p, 'utf8').replace(/[\r\n]+$/, '');
}

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// Escape the few chars that would break HTML when a label/verdict is dropped inside <summary>.
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Pull the verdict out of 05-tldr.md's "**Verdict: Approve with Comments**" line for the outer summary.
function parseVerdict(tldr) {
  const m = /\*\*Verdict:\s*([^*]+?)\s*\*\*/.exec(tldr);
  return m ? m[1].trim() : '';
}

if (command === 'init') {
  mkdirSync(sectionsDir, { recursive: true });
  // Clean any prior section files so a subagent's create_file doesn't collide on re-run.
  for (const f of readdirSync(sectionsDir)) {
    if (f.endsWith('.md')) rmSync(join(sectionsDir, f), { force: true });
  }
  console.log(JSON.stringify({ sectionsDir }));
  process.exit(0);
}

if (command === 'review') {
  if (!existsSync(sectionsDir)) fail(1, `sections dir not found: ${sectionsDir} (run "init" + Step 7 first)`);
  // Sort by filename so the numeric section prefixes (00-, 05-, 10-, ...) order correctly.
  const files = readdirSync(sectionsDir).filter((f) => f.endsWith('.md')).sort();
  // Explicit blank-line delimiter -- a section missing its trailing newline must not collapse into the next heading.
  const body = files.map((f) => readTrim(join(sectionsDir, f))).join('\n\n');
  const reviewFile = join(base, 'review.md');
  writeFileSync(reviewFile, body + '\n');
  console.log(JSON.stringify({ reviewFile, sections: files.length }));
  process.exit(0);
}

if (command === 'comment') {
  const metaPath = arg('--meta', '');
  const meta = metaPath ? readJson(resolve(process.cwd(), metaPath)) : null;
  if (metaPath && !meta) fail(1, `--meta file unreadable or not valid JSON: ${metaPath}`);
  const m = meta || {};
  const model = m.model || '';
  const tool = m.tool || 'pr-review';
  const version = m.version || '';
  // Required sections must exist -- a missing one is a workflow error, not an uncaught ENOENT throw.
  for (const req of ['05-tldr.md', '10-intent.md']) {
    if (!existsSync(join(sectionsDir, req))) fail(1, `required section missing: sections/${req} (run Step 7 / Step 8 first)`);
  }
  const header = `## AI Code Review\n\n*Generated by GitHub Copilot (${model}) | ${tool} ${version}*`;
  const tldr = readTrim(join(sectionsDir, '05-tldr.md'));
  const footer = '---\n_[AI-generated review - please verify before acting]_';

  // Curated collapsible catalog (render order). Each present section is folded into a <details> block so the
  // posted comment stays scannable across multiple review rounds. Only the CURATED sections go in the comment:
  // the raw subagent analyses (20-logic / 30-impact / 40-quality) are deliberately NOT included -- they
  // duplicate the validated findings 2-3x and, being PRE-validation, can contradict the Finding Validation
  // verdicts (e.g. show a claim the validator later refuted). They stay in review.md for local exploration.
  // The ICM comment (90-icm.md) is likewise NOT posted -- it stays local-only for manual copy-paste into ICM
  // (contract: reference.md / finalize.md footer / SKILL.md). Do NOT add an 'icm' entry back to this catalog.
  const CATALOG = [
    { key: 'intent', file: '10-intent.md', label: 'Intent & Approach' },
    { key: 'validation', file: '50-validation.md', label: 'Finding Validation — per-finding verdicts + evidence' },
  ];
  const collapseSet = Array.isArray(m.collapse) ? new Set(m.collapse) : null; // null = collapse every present section
  const wrap = m.wrap !== false; // outer whole-comment <details open>; default on
  const verdict = m.verdict || parseVerdict(tldr); // outer summary suffix

  // ADO renders <details> only with a blank line after </summary> AND after </details>; GitHub tolerates it.
  function collapsible(label, body) {
    return `<details>\n<summary><strong>${escapeHtml(label)}</strong></summary>\n\n${body}\n\n</details>`;
  }
  // Strip a single leading "## Heading" line (+ trailing blank) so it doesn't duplicate the <summary> label.
  function stripLeadHeading(body) {
    return body.replace(/^##\s+.*\r?\n\r?\n?/, '');
  }

  // Build the collapsed section blocks in catalog order.
  const blocks = [];
  for (const s of CATALOG) {
    const p = join(sectionsDir, s.file);
    if (!existsSync(p)) continue;
    const raw = readTrim(p);
    if (!raw) continue;
    const doCollapse = collapseSet ? collapseSet.has(s.key) : true;
    blocks.push({ key: s.key, text: doCollapse ? collapsible(s.label, stripLeadHeading(raw)) : raw });
  }

  const inner = [header, tldr, ...blocks.map((b) => b.text), footer].filter((p) => p !== '');
  const bodyStr = inner.join('\n\n');
  // Wrap the whole comment in an outer <details open> (default-expanded; click the inline summary to collapse
  // the entire round). The formal `## AI Code Review` heading is kept inside as body content.
  const out = wrap
    ? `<details open>\n<summary><strong>AI Code Review${verdict ? ` &mdash; ${escapeHtml(verdict)}` : ''}</strong></summary>\n\n${bodyStr}\n\n</details>\n`
    : bodyStr + '\n';

  const commentFile = join(base, 'pr-comment.md');
  writeFileSync(commentFile, out);
  console.log(JSON.stringify({ commentFile, bytes: out.length, wrapped: wrap, collapsed: blocks.map((b) => b.key) }));
  process.exit(0);
}

if (command === 'lint') {
  const file = join(base, 'pr-comment.md');
  if (!existsSync(file)) fail(1, `pr-comment.md not found: ${file} (build it first)`);
  const lines = readFileSync(file, 'utf8').split('\n');

  // Check 1: any markdown link whose target is not an absolute URL / anchor is a workspace-relative
  // path -- forbidden in the posted comment (it would 404 or leak a local path).
  const relRe = /\]\((?!https?:|mailto:|#)/;
  const relativeLinks = [];
  lines.forEach((ln, i) => { if (relRe.test(ln)) relativeLinks.push({ line: i + 1, text: ln.trim() }); });

  // Check 2: each provider forbiddenAutoLinkPatterns entry (regex that a host would auto-link).
  const autoLinks = [];
  const patternsPath = arg('--patterns', '');
  if (patternsPath) {
    const patterns = readJson(resolve(process.cwd(), patternsPath));
    // Refuse to silently skip the gate: an unreadable / invalid patterns file is a hard error, not a bypass.
    if (!Array.isArray(patterns)) fail(1, `--patterns file unreadable or not a JSON array: ${patternsPath} (refusing to skip the auto-link gate)`);
    for (const p of patterns) {
      let re;
      try { re = new RegExp(p.pattern); } catch { continue; }
      const hits = [];
      lines.forEach((ln, i) => { if (re.test(ln)) hits.push(i + 1); });
      if (hits.length) autoLinks.push({ pattern: p.pattern, autoLinksTo: p.autoLinksTo, safe: p.safeReplacement, lines: hits });
    }
  }

  const clean = relativeLinks.length === 0 && autoLinks.length === 0;
  console.log(JSON.stringify({ clean, relativeLinks, autoLinks }));
  process.exit(clean ? 0 : 3);
}
