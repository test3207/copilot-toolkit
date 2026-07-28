#!/usr/bin/env node
// lint-recipes.mjs -- recipe inline-shell gate for the "recipe glue = Node script,
// not inline shell" rule (tool-dev/SKILL.md).
//
// A skill/workflow recipe must not embed a MULTI-STEP pwsh/bash block -- deterministic
// multi-step glue belongs in a committed scripts/<name>.mjs. Single host commands
// (git --no-pager ..., gh ...) stay inline. Scanned ONLY in recipe files (paths under a
// /skills/ or /prompts/ segment) so usage-example blocks in README / INSTALL / templates
// never trip.
//
// Opt out an intentional inline block with an HTML comment on the line immediately
// above the opening fence:  <!-- lint-recipes: allow <reason> -->
//
// Usage:
//   node lint-recipes.mjs [<path> ...]      (default: .github)
//
// stdout = one `<file>:<line>: <reason>` per flagged fenced block.
// Exit codes: 0 = clean | 1 = >=1 violation | 2 = bad usage / path not found.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const RECIPE_LANGS = new Set(['pwsh', 'powershell', 'bash', 'sh', 'shell']);

const paths = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (paths.length === 0) paths.push('.github');

function fail(code, message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(code);
}

// Enumerate *.md files under the given paths (recursive for directories).
function walk(p, acc) {
  let st;
  try { st = statSync(p); } catch { fail(2, `path not found: ${p}`); }
  if (st.isDirectory()) {
    for (const e of readdirSync(p).sort()) walk(join(p, e), acc);
  } else if (p.toLowerCase().endsWith('.md')) {
    acc.push(p);
  }
  return acc;
}

// Only recipe files (under a skills/ or prompts/ path segment) are subject to the gate.
function isRecipeFile(p) {
  const norm = p.split(sep).join('/');
  return /(^|\/)(skills|prompts)\//.test(norm);
}

// '' if the block is a single host command (OK); else a short reason string.
function classifyBlock(bodyLines) {
  // Join line-continuations (pwsh trailing backtick, bash trailing backslash).
  const joined = [];
  let acc = '';
  for (const raw of bodyLines) {
    const line = acc ? `${acc} ${raw.trimStart()}` : raw;
    const t = line.replace(/\s+$/, '');
    if (t.endsWith('`') || t.endsWith('\\')) { acc = t.slice(0, -1).replace(/\s+$/, ''); continue; }
    acc = '';
    joined.push(line);
  }
  if (acc) joined.push(acc);

  const stmts = joined.filter((l) => { const s = l.trim(); return s && !s.startsWith('#'); });
  if (stmts.length === 0) return '';

  // Quote-stripped view so a '|' or ';' inside a quoted --jq expr / message string is not
  // mistaken for a shell pipe / command chain.
  const stripped = stmts.join('\n').replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '');

  if (stmts.length > 1) return `multi-step inline shell (${stmts.length} statements)`;
  if (/[|;]|&&/.test(stripped)) return 'inline shell with pipe / command chaining';
  if (/(^|=|\(|\{|;)\s*(if|elseif|else|foreach|for|while|switch|do|until)\b/im.test(stripped)
      || /\b(then|elif|fi|esac|done)\b/m.test(stripped)) {
    return 'inline shell with control-flow keyword';
  }
  return '';
}

const FENCE_OPEN = /^\s*```+\s*([A-Za-z0-9_-]+)\s*$/;
const FENCE_CLOSE = /^\s*```+\s*$/;
const ALLOW_MARKER = /<!--\s*lint-recipes:\s*allow\b/i;

let violations = 0;
const files = [];
for (const p of paths) walk(p, files);

for (const file of files) {
  if (!isRecipeFile(file)) continue;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const m = FENCE_OPEN.exec(lines[i]);
    if (m && RECIPE_LANGS.has(m[1].toLowerCase())) {
      const openLine = i + 1;
      // Opt-out marker must be on the line IMMEDIATELY above the opening fence (strictly adjacent).
      const exempt = i > 0 && ALLOW_MARKER.test(lines[i - 1]);
      const body = [];
      let k = i + 1;
      while (k < lines.length && !FENCE_CLOSE.test(lines[k])) { body.push(lines[k]); k++; }
      if (!exempt) {
        const reason = classifyBlock(body);
        if (reason) {
          console.log(`${file}:${openLine}: ${reason} -- move glue to scripts/<name>.mjs (tool-dev rule) or add <!-- lint-recipes: allow <reason> --> above the fence`);
          violations++;
        }
      }
      i = k + 1;
      continue;
    }
    i++;
  }
}

process.exit(violations > 0 ? 1 : 0);
