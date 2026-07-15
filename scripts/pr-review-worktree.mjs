#!/usr/bin/env node
// pr-review-worktree.mjs -- deterministic worktree setup/cleanup for pr-review Step 3/4.
//
// Creates an isolated, SEARCHABLE git worktree of the PR source branch so a review never
// mutates the user's working tree and parallel reviews of DIFFERENT PRs don't collide.
//
// Two-mode aware: every git call runs against {repo-path} via `git -C`, so it works whether
// the reviewed repo is the workspace root (plugin mode, path ".") or a git submodule
// (L2 mode, path "repos/<name>").
//
// The worktree lands at a NON-ignored, in-workspace path (VS Code grep/file/semantic search
// only reach in-workspace, non-ignored files) so subagents can search it directly -- no
// includeIgnoredFiles hacks. Review OUTPUT artifacts stay under the self-ignored pr-review/ tree.
//
// git is invoked with execFileSync + an args ARRAY (no shell), so there is no cross-platform
// quoting/escaping hazard.
//
// Optional, OPT-IN enrichment (TRUSTED repos only -- default OFF): a `worktree` config block
// { submodules: false|true|"recursive", setup: ["npm ci", ...] } can init submodules and run
// build/setup commands inside the worktree so subagents get type info + deep submodule diffs.
// Precedence L3 > L2 > default OFF: the reviewed repo's OWN .github/pr-review.json (read from the
// BASE checkout, so a PR cannot inject commands) wins; else the caller-resolved --config file
// (L2 registry); else off. Enrichment runs `git submodule update` (CVE-2018-11235 recursive-clone
// RCE surface) and arbitrary `setup` shell commands (postinstall RCE surface) -- ONLY enable for
// repos you trust. Any enrichment failure DEGRADES (adds a warning) and never blocks the review.
//
// Usage:
//   setup:   node pr-review-worktree.mjs setup   --repo-path <p> --repo <name> --pr-id <id> --source <branch> --target <branch> [--config <json-file>]
//   cleanup: node pr-review-worktree.mjs cleanup --repo-path <p> --repo <name> --pr-id <id>
//
// stdout (setup) = one JSON object:
//   { worktree, outDir, diffFile, changedFiles, additions, deletions,
//     submoduleBumps: [{ path, from, to, commits? }], enrichment: {...}, warnings: [] }
// Exit: 0 = ok; 1 = usage/precondition error; 2 = git setup failure (worktree unavailable / fetch / add).

import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function fail(code, message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(code);
}

const command = process.argv[2];
const repoPath = arg('--repo-path', '.');
const repo = arg('--repo');
const prId = arg('--pr-id');

if (!command || !['setup', 'cleanup'].includes(command)) {
  fail(1, 'first arg must be "setup" or "cleanup"');
}
if (!repo || !prId) {
  fail(1, '--repo and --pr-id are required');
}

// Absolute worktree path, resolved from the node process cwd (= workspace root). MUST be
// absolute: `git -C {repoPath}` resolves relative paths against {repoPath}, not the workspace root.
const worktree = resolve(process.cwd(), 'pr-review-worktree', repo, prId, 'worktree');
// Output artifacts live under the self-ignored pr-review/ tree (relative to workspace root).
const outDir = resolve(process.cwd(), 'pr-review', repo, prId);
const diffFile = resolve(outDir, 'diff.txt');

// git via execFileSync -- args as an array, NO shell -> no quoting/escaping hazard.
function git(args) {
  return execFileSync('git', ['-C', repoPath, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
}
function gitTry(args) {
  try { return { ok: true, out: git(args).toString() }; }
  catch (e) { return { ok: false, out: (e.stdout || '').toString(), err: (e.stderr || e.message || '').toString() }; }
}

// git against an ARBITRARY dir (the worktree or a nested submodule), not {repoPath}.
function gitAt(dir, args) {
  try {
    return { ok: true, out: execFileSync('git', ['-C', dir, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
    }).toString() };
  } catch (e) { return { ok: false, out: (e.stdout || '').toString(), err: (e.stderr || e.message || '').toString() }; }
}

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function normSubmodules(v) {
  if (v === true || v === 'true') return 'true';
  if (v === 'recursive') return 'recursive';
  return 'false';
}

// Resolve the effective `worktree` config. Layer default -> L2 (--config file) -> L3 (repo's own
// .github/pr-review.json, read from the BASE checkout), so L3 wins. Returns { submodules, setup, source }.
function resolveWorktreeConfig() {
  const cfg = { submodules: 'false', setup: [], source: 'none' };
  const l2path = arg('--config', '');
  if (l2path) {
    const j = readJson(resolve(process.cwd(), l2path));
    const w = j && j.worktree ? j.worktree : j;
    if (w && typeof w === 'object') {
      if ('submodules' in w) cfg.submodules = normSubmodules(w.submodules);
      if (Array.isArray(w.setup)) cfg.setup = w.setup.filter((c) => typeof c === 'string');
      cfg.source = 'l2';
    }
  }
  const l3 = readJson(resolve(repoPath, '.github', 'pr-review.json'));
  if (l3 && l3.worktree && typeof l3.worktree === 'object') {
    const w = l3.worktree;
    if ('submodules' in w) cfg.submodules = normSubmodules(w.submodules);
    if (Array.isArray(w.setup)) cfg.setup = w.setup.filter((c) => typeof c === 'string');
    cfg.source = 'l3';
  }
  return cfg;
}

function preClean() {
  // Remove any stale registration AND leftover dir. Handles both interrupted-run states:
  // registered-but-missing (=> add exit 128) and dir-present-but-registration-lost (=> "already exists").
  if (existsSync(worktree)) {
    gitTry(['worktree', 'remove', '--force', worktree]);
    try { rmSync(worktree, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  gitTry(['worktree', 'prune']);
}

if (command === 'cleanup') {
  preClean();
  console.log(JSON.stringify({ removed: worktree }));
  process.exit(0);
}

// ---- setup ----
const source = arg('--source');
const target = arg('--target');
if (!source || !target) {
  fail(1, 'setup requires --source and --target');
}

const warnings = [];

// HARD REQUIREMENT: git worktree must be available (git >= 2.5). No fallback.
if (!gitTry(['worktree', 'list']).ok) {
  fail(2, 'git worktree unavailable -- pr-review requires git >= 2.5');
}

// Scaffold the self-ignored OUTPUT tree (diff.txt etc. land here regardless of provider overrides).
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(process.cwd(), 'pr-review', '.gitignore'), '*\n');
mkdirSync(resolve(process.cwd(), 'pr-review-worktree', repo, prId), { recursive: true });

preClean();

// Fetch both refs. Source fetch is fatal (can't build the worktree); target fetch is a warning
// (diff base may be stale -- B-031 -- but the worktree still builds).
const fetchSource = gitTry(['--no-pager', 'fetch', 'origin', source]);
if (!fetchSource.ok) {
  fail(2, `fetch of source branch '${source}' failed -- cannot build the review worktree: ${fetchSource.err.trim()}`);
}
const fetchTarget = gitTry(['--no-pager', 'fetch', 'origin', target]);
if (!fetchTarget.ok) {
  warnings.push(`fetch of target branch '${target}' failed -- diff base may be stale (B-031)`);
}

// Detached HEAD at the fetched source ref -- a branch can be checked out in only one worktree,
// so detaching keeps the user's own checkout of the same branch collision-free.
const add = gitTry(['worktree', 'add', '--detach', worktree, `origin/${source}`]);
if (!add.ok) {
  fail(2, `git worktree add failed -- on Windows a MAX_PATH error needs core.longpaths=true: ${add.err.trim()}`);
}

// ---- Enrichment (opt-in, TRUSTED repos only; failures degrade, never block) ----
const cfg = resolveWorktreeConfig();
const enrichment = { submodules: cfg.submodules, configSource: cfg.source, submoduleUpdate: 'skipped', setup: [] };

if (cfg.submodules !== 'false') {
  const smArgs = ['submodule', 'update', '--init'];
  if (cfg.submodules === 'recursive') smArgs.push('--recursive');
  const sm = gitAt(worktree, smArgs);
  if (sm.ok) {
    enrichment.submoduleUpdate = 'ok';
  } else {
    enrichment.submoduleUpdate = 'failed';
    warnings.push(`submodule update failed (non-blocking): ${(sm.err.trim().split('\n')[0] || '').slice(0, 200)}`);
  }
}

for (const cmd of cfg.setup) {
  // Trusted, opt-in config -> shell is intentional here (commands like `npm ci`); cwd = worktree.
  try {
    execSync(cmd, { cwd: worktree, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true, timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    enrichment.setup.push({ cmd, ok: true });
  } catch {
    enrichment.setup.push({ cmd, ok: false });
    warnings.push(`setup command failed (non-blocking): ${cmd}`);
  }
}

if (enrichment.configSource === 'none' && repoPath === '.') {
  enrichment.hint = 'No worktree enrichment configured -- add a "worktree" block ({ submodules, setup }) to .github/pr-review.json for submodule-aware + type-aware checks (trusted repos only).';
}

// Diff is computed from refs (target...source), independent of the worktree HEAD.
const range = `origin/${target}...origin/${source}`;
const nameOnly = gitTry(['--no-pager', 'diff', '--name-only', range]);
const changedList = nameOnly.ok ? nameOnly.out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
writeFileSync(resolve(outDir, 'changed-files.txt'), changedList.join('\n') + (changedList.length ? '\n' : ''));

const patch = gitTry(['--no-pager', 'diff', range]);
writeFileSync(diffFile, patch.ok ? patch.out : '');

const shortstat = gitTry(['--no-pager', 'diff', '--shortstat', range]).out || '';
const additions = parseInt((shortstat.match(/(\d+) insertion/) || [])[1] || '0', 10);
const deletions = parseInt((shortstat.match(/(\d+) deletion/) || [])[1] || '0', 10);

// Submodule pointer-bump detection (cheap, always on): --raw exposes gitlink (mode 160000) changes.
const raw = gitTry(['--no-pager', 'diff', '--raw', range]).out || '';
const submoduleBumps = [];
for (const line of raw.split('\n')) {
  const m = line.match(/^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) \w+\t(.+)$/);
  if (m && (m[1] === '160000' || m[2] === '160000')) {
    submoduleBumps.push({ path: m[5], from: m[3], to: m[4] });
  }
}

// Deep submodule diff (opt-in): only once submodules were fetched via enrichment can we resolve
// the bumped from..to range into the actual commit list. Best-effort -- absent shas are skipped.
if (cfg.submodules !== 'false' && enrichment.submoduleUpdate === 'ok') {
  for (const b of submoduleBumps) {
    const subDir = resolve(worktree, b.path);
    if (!existsSync(subDir)) continue;
    const log = gitAt(subDir, ['--no-pager', 'log', '--oneline', '--no-decorate', `${b.from}..${b.to}`]);
    if (log.ok && log.out.trim()) {
      b.commits = log.out.trim().split('\n').slice(0, 50);
    }
  }
}

console.log(JSON.stringify({
  worktree,
  outDir,
  diffFile,
  changedFiles: changedList.length,
  additions,
  deletions,
  submoduleBumps,
  enrichment,
  warnings,
}));
