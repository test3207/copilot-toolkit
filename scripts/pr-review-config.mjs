#!/usr/bin/env node
// pr-review-config.mjs -- resolve the machine-local post-mode + harness-profile for pr-review
// Step 0, auto-provisioning a self-ignored .github/pr-review.local/ folder on first run.
//
// post-mode controls whether Step 9.2 posts the PR comment:
//   confirm (default) -- ask y/n before posting (current, safe behavior)
//   auto              -- unattended: post with no prompt (full hands-off run)
//   skip              -- never post; keep local artifacts only (dry-run)
//
// harness-profile controls how much MODEL-CAPABILITY scaffolding the skill loads
// (skills/pr-review/harness-profile/<profile>.md -- see that folder's _index.md):
//   strict (default)  -- every scaffolding rule (tuned against the model family the skill grew on)
//   standard          -- dispatch + assembly guards only
//   minimal           -- none
// It NEVER tiers the workflow contract, safety/authority rules (post-mode gating, base-checkout
// config reads), or the unconditional worktree cleanup -- those hold at every profile.
//
// Precedence (identical shape for both keys):
//   CLI --post-mode / --harness-profile > {repo}/.github/pr-review.local/config.json > default.
//
// The local.json is MACHINE-LOCAL and NEVER committed. "auto" is an operator trust decision,
// not a repo-shared property -- if it rode into the repo, every checkout would silently inherit
// unattended posting to real PRs. So it lives only in a gitignored file or a per-call flag, and
// the safe default is always "confirm".
//
// First-run auto-init: on an interactive run (no CLI flag) with no config present, the script
// scaffolds a SELF-IGNORED folder {repo}/.github/pr-review.local/ (config.json defaulting to
// "confirm" + "strict", plus a ".gitignore" of "*" so the folder ignores its own contents). This
// never touches the reviewed repo's root .gitignore. It reports firstRun:true + a notice so Step 0
// can surface a one-time hint (modes + profiles + the "auto" safety warning). When a CLI flag IS
// passed (CI / unattended path) NOTHING is written -- zero-config, no repo mutation.
//
// git/file access runs against {repo-path} so it works whether the reviewed repo is the
// workspace root (plugin mode, path ".") or a git submodule (L2 mode, path "repos/<name>").
//
// Usage:
//   node pr-review-config.mjs resolve --repo-path <p> [--post-mode <confirm|auto|skip>]
//                                                     [--harness-profile <strict|standard|minimal>]
//
// stdout = one JSON object:
//   { postMode, source, harnessProfile, harnessProfileSource, firstRun, scaffolded, localPath, notice? }
//   (`source` is the postMode source, kept under its original name for back-compat.)
// Exit: 0 = ok; 1 = usage / precondition error.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const MODES = ['confirm', 'auto', 'skip'];
const PROFILES = ['strict', 'standard', 'minimal'];
const DEFAULT_MODE = 'confirm';
const DEFAULT_PROFILE = 'strict';

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

function cliValue(flag, allowed) {
  const raw = arg(flag, '');
  const value = (raw || '').trim().toLowerCase();
  if (value && !allowed.includes(value)) {
    fail(1, `${flag} must be one of ${allowed.join(' | ')} (got "${raw}")`);
  }
  return value;
}

const cliMode = cliValue('--post-mode', MODES);
const cliProfile = cliValue('--harness-profile', PROFILES);
const hasCliOverride = Boolean(cliMode || cliProfile);

// Machine-local prefs live in a SELF-IGNORED folder: {repo}/.github/pr-review.local/ holds
// config.json plus a ".gitignore" of "*", so the folder ignores its own contents (including that
// .gitignore). This never touches the reviewed repo's root .gitignore -- mirrors the
// pr-review-worktree "pr-review/.gitignore = *" self-ignore precedent.
const localDir = resolve(process.cwd(), repoPath, '.github', 'pr-review.local');
const localPath = join(localDir, 'config.json');
const relLocalDir = join(repoPath, '.github', 'pr-review.local').replace(/\\/g, '/');
const relLocalPath = join(repoPath, '.github', 'pr-review.local', 'config.json').replace(/\\/g, '/');

const notices = [];
let postMode = DEFAULT_MODE;
let postModeSource = 'default';
let harnessProfile = DEFAULT_PROFILE;
let harnessProfileSource = 'default';
let firstRun = false;
let scaffolded = false;

function emit() {
  console.log(JSON.stringify({
    postMode,
    source: postModeSource,          // kept for back-compat: source of postMode
    harnessProfile,
    harnessProfileSource,
    firstRun,
    scaffolded,
    localPath: relLocalPath,
    ...(notices.length ? { notice: notices.join('\n') } : {}),
  }));
  process.exit(0);
}

// 1) Machine-local config.json (lower precedence than the CLI flags applied below).
const hasLocalFile = existsSync(localPath);
if (hasLocalFile) {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonComments(readFileSync(localPath, 'utf8')));
  } catch {
    notices.push(`Could not parse ${relLocalPath}; using defaults ("${DEFAULT_MODE}" / "${DEFAULT_PROFILE}"). Fix the JSON or delete the file to re-scaffold.`);
    parsed = null;
  }
  if (parsed) {
    const fileMode = (parsed['post-mode'] || '').toString().trim().toLowerCase();
    if (MODES.includes(fileMode)) {
      postMode = fileMode;
      postModeSource = 'local-file';
    } else if (fileMode) {
      notices.push(`${relLocalPath} has an invalid "post-mode" (expected ${MODES.join(' | ')}); defaulting to "${DEFAULT_MODE}".`);
    } else {
      notices.push(`${relLocalPath} has no "post-mode"; defaulting to "${DEFAULT_MODE}".`);
    }

    const fileProfile = (parsed['harness-profile'] || '').toString().trim().toLowerCase();
    if (PROFILES.includes(fileProfile)) {
      harnessProfile = fileProfile;
      harnessProfileSource = 'local-file';
    } else if (fileProfile) {
      notices.push(`${relLocalPath} has an invalid "harness-profile" (expected ${PROFILES.join(' | ')}); defaulting to "${DEFAULT_PROFILE}".`);
    }
    // A config.json written before harness-profile existed simply keeps the default.
  }
}

// 2) CLI flags win over the file and write nothing (zero-config CI / unattended path).
if (cliMode) {
  postMode = cliMode;
  postModeSource = 'cli';
}
if (cliProfile) {
  harnessProfile = cliProfile;
  harnessProfileSource = 'cli';
}

// 3) First interactive run (no flag, no file): scaffold config.json + gitignore it.
if (!hasLocalFile && !hasCliOverride) {
  const scaffold = {
    _help: 'Machine-local pr-review preferences -- NOT committed (gitignored). ' +
      '"post-mode" controls Step 9.2 PR-comment posting: ' +
      '"confirm" = ask before posting (default, safe); ' +
      '"auto" = post unattended with no prompt (hands-off; posts to the real PR); ' +
      '"skip" = never post, keep local artifacts only (dry-run). ' +
      '"harness-profile" selects how much model-capability scaffolding the skill loads: ' +
      '"strict" = all of it (default); "standard" = the dispatch/assembly guards only; ' +
      '"minimal" = none. It never weakens posting, config-trust, or cleanup behavior. ' +
      'Override per call with /pr-review ... --auto | --confirm | --skip-post | --harness-profile <p>.',
    'post-mode': DEFAULT_MODE,
    'harness-profile': DEFAULT_PROFILE,
  };
  try {
    mkdirSync(localDir, { recursive: true });
    writeFileSync(localPath, JSON.stringify(scaffold, null, 2) + '\n', 'utf8');
    // Self-ignore the whole folder (including this .gitignore itself) -- never touches root .gitignore.
    writeFileSync(join(localDir, '.gitignore'), '*\n', 'utf8');
    firstRun = true;
    scaffolded = true;
    notices.push(
      `First pr-review run: created ${relLocalPath} (self-ignored via ${relLocalDir}/.gitignore, never committed) with post-mode "${DEFAULT_MODE}" and harness-profile "${DEFAULT_PROFILE}".\n` +
      'Posting policy (Step 9.2):\n' +
      '  - confirm (current): asks before posting the review comment.\n' +
      '  - auto:    posts the comment unattended -- WARNING: hands-off, posts to the real PR with no prompt.\n' +
      '  - skip:    never posts; keeps the local pr-comment.md only (dry-run).\n' +
      'Harness profile (how much model-capability scaffolding is loaded):\n' +
      '  - strict (current): every scaffolding rule.\n' +
      '  - standard: dispatch + assembly guards only.\n' +
      '  - minimal: none -- the workflow contract, safety, and cleanup rules still apply at every profile.\n' +
      `Change either by editing ${relLocalPath}, or override per call with --auto / --confirm / --skip-post / --harness-profile <strict|standard|minimal>.`,
    );
  } catch (e) {
    // Non-fatal: fall back to the safe defaults without a persisted file.
    notices.push(`Could not scaffold ${relLocalDir} (${(e && e.message) || e}); using "${DEFAULT_MODE}" / "${DEFAULT_PROFILE}" for this run.`);
  }
}

emit();
