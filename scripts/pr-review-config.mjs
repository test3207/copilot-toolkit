#!/usr/bin/env node
// pr-review-config.mjs -- resolve the machine-local post-mode for pr-review Step 0,
// auto-provisioning a self-ignored .github/pr-review.local/ folder on first run.
//
// post-mode controls whether Step 9.2 posts the PR comment:
//   confirm (default) -- ask y/n before posting (current, safe behavior)
//   auto              -- unattended: post with no prompt (full hands-off run)
//   skip              -- never post; keep local artifacts only (dry-run)
//
// Precedence: CLI --post-mode > {repo}/.github/pr-review.local/config.json "post-mode" > "confirm".
//
// The local.json is MACHINE-LOCAL and NEVER committed. "auto" is an operator trust decision,
// not a repo-shared property -- if it rode into the repo, every checkout would silently inherit
// unattended posting to real PRs. So it lives only in a gitignored file or a per-call flag, and
// the safe default is always "confirm".
//
// First-run auto-init: on an interactive run (no --post-mode flag) with no config present, the
// script scaffolds a SELF-IGNORED folder {repo}/.github/pr-review.local/ (config.json defaulting
// to "confirm" + a ".gitignore" of "*" so the folder ignores its own contents). This never touches
// the reviewed repo's root .gitignore. It reports firstRun:true + a notice so Step 0 can surface a
// one-time hint (three modes + the "auto" safety warning). When a --post-mode flag IS passed
// (CI / unattended path) NOTHING is written -- zero-config, no repo mutation.
//
// git/file access runs against {repo-path} so it works whether the reviewed repo is the
// workspace root (plugin mode, path ".") or a git submodule (L2 mode, path "repos/<name>").
//
// Usage:
//   node pr-review-config.mjs resolve --repo-path <p> [--post-mode <confirm|auto|skip>]
//
// stdout = one JSON object: { postMode, source, firstRun, scaffolded, localPath, notice? }
// Exit: 0 = ok; 1 = usage / precondition error.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const MODES = ['confirm', 'auto', 'skip'];

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function fail(code, message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(code);
}

// Minimal JSONC tolerance: strip // line and /* */ block comments not inside strings.
function stripJsonComments(text) {
  let out = '';
  let inStr = false;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += n ?? ''; i++; continue; }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === '\'') { inStr = true; quote = c; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return out;
}

const command = process.argv[2];
if (command !== 'resolve') fail(1, 'first arg must be "resolve"');

const repoPath = arg('--repo-path', '.');
const cliRaw = arg('--post-mode', '');
const cli = (cliRaw || '').trim().toLowerCase();
if (cli && !MODES.includes(cli)) {
  fail(1, `--post-mode must be one of ${MODES.join(' | ')} (got "${cliRaw}")`);
}

// Machine-local prefs live in a SELF-IGNORED folder: {repo}/.github/pr-review.local/ holds
// config.json plus a ".gitignore" of "*", so the folder ignores its own contents (including that
// .gitignore). This never touches the reviewed repo's root .gitignore -- mirrors the
// pr-review-worktree "pr-review/.gitignore = *" self-ignore precedent.
const localDir = resolve(process.cwd(), repoPath, '.github', 'pr-review.local');
const localPath = join(localDir, 'config.json');
const relLocalDir = join(repoPath, '.github', 'pr-review.local').replace(/\\/g, '/');
const relLocalPath = join(repoPath, '.github', 'pr-review.local', 'config.json').replace(/\\/g, '/');

// 1) CLI flag wins and writes nothing (zero-config CI / unattended path).
if (cli) {
  console.log(JSON.stringify({ postMode: cli, source: 'cli', firstRun: false, scaffolded: false, localPath: relLocalPath }));
  process.exit(0);
}

// 2) Existing local.json.
if (existsSync(localPath)) {
  let mode = '';
  try {
    const parsed = JSON.parse(stripJsonComments(readFileSync(localPath, 'utf8')));
    mode = (parsed['post-mode'] || '').toString().trim().toLowerCase();
  } catch {
    console.log(JSON.stringify({
      postMode: 'confirm', source: 'default', firstRun: false, scaffolded: false, localPath: relLocalPath,
      notice: `Could not parse ${relLocalPath}; defaulting to "confirm". Fix the JSON or delete the file to re-scaffold.`,
    }));
    process.exit(0);
  }
  if (MODES.includes(mode)) {
    console.log(JSON.stringify({ postMode: mode, source: 'local-file', firstRun: false, scaffolded: false, localPath: relLocalPath }));
    process.exit(0);
  }
  console.log(JSON.stringify({
    postMode: 'confirm', source: 'default', firstRun: false, scaffolded: false, localPath: relLocalPath,
    notice: `${relLocalPath} has no valid "post-mode" (expected ${MODES.join(' | ')}); defaulting to "confirm".`,
  }));
  process.exit(0);
}

// 3) First interactive run: scaffold local.json (default confirm) + gitignore it.
const scaffold = {
  _help: 'Machine-local pr-review preferences -- NOT committed (gitignored). ' +
    '"post-mode" controls Step 9.2 PR-comment posting: ' +
    '"confirm" = ask before posting (default, safe); ' +
    '"auto" = post unattended with no prompt (hands-off; posts to the real PR); ' +
    '"skip" = never post, keep local artifacts only (dry-run). ' +
    'Override per call with /pr-review ... --auto | --confirm | --skip-post.',
  'post-mode': 'confirm',
};

try {
  mkdirSync(localDir, { recursive: true });
  writeFileSync(localPath, JSON.stringify(scaffold, null, 2) + '\n', 'utf8');
  // Self-ignore the whole folder (including this .gitignore itself) -- never touches root .gitignore.
  writeFileSync(join(localDir, '.gitignore'), '*\n', 'utf8');
} catch (e) {
  // Non-fatal: fall back to the safe default without a persisted file.
  console.log(JSON.stringify({
    postMode: 'confirm', source: 'default', firstRun: false, scaffolded: false, localPath: relLocalPath,
    notice: `Could not scaffold ${relLocalDir} (${(e && e.message) || e}); using "confirm" for this run.`,
  }));
  process.exit(0);
}

const notice =
  `First pr-review run: created ${relLocalPath} (self-ignored via ${relLocalDir}/.gitignore, never committed) with post-mode "confirm".\n` +
  'Posting policy (Step 9.2):\n' +
  '  - confirm (current): asks before posting the review comment.\n' +
  '  - auto:    posts the comment unattended -- WARNING: hands-off, posts to the real PR with no prompt.\n' +
  '  - skip:    never posts; keeps the local pr-comment.md only (dry-run).\n' +
  `Change it by editing "post-mode" in ${relLocalPath}, or override per call with --auto / --confirm / --skip-post.`;

console.log(JSON.stringify({ postMode: 'confirm', source: 'default', firstRun: true, scaffolded: true, localPath: relLocalPath, notice }));
process.exit(0);
