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
//   { worktree, searchGlob, outDir, diffFile, changedFiles, additions, deletions,
//     submoduleBumps: [{ path, from, to, commits? }], enrichment: {...}, warnings: [],
//     orphans?: { count, paths } }
// stdout (cleanup) = one JSON object:
//   { removed: boolean, paths: string[],
//     leaked?: [{ path, remainingFiles: number|null, error, markerError? }], errors?: [{ path, error }], hint?: string }
// Exit: 0 = ok; 1 = usage/precondition error; 2 = git setup failure (worktree unavailable / fetch / add).

import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, rmdirSync, statSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';

// Single source for the marker contract -- it is written, classified and swept from three different
// places, and drift between them silently disables reclaim.
const ORPHAN_MARKER = '.pr-review-orphan';
const LEAF_NAME_RE = /^worktree(-\d+)?$/;
const DELETE_RETRIES = 5;
const DELETE_RETRY_MS = 200;

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
// These build filesystem paths that reach rmSync(recursive) -- reject separators / traversal (defense-in-depth).
if (/[/\\]|\.\./.test(repo) || /[/\\]|\.\./.test(prId)) {
  fail(1, '--repo and --pr-id must not contain path separators or ".."');
}

// prDir is the per-PR container; the actual worktree leaf is allocated inside it by P1.
const prDir = resolve(process.cwd(), 'pr-review-worktree', repo, prId);
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

// 'live' | 'orphan' | 'unknown'. A linked worktree's .git is a file holding 'gitdir: <path>';
// after worktree remove --force succeeds the admin dir is gone, so a surviving leaf reads orphan.
// A leaf carrying .pr-review-orphan classifies orphan even when .git is absent (unknown state).
function leafState(leafDir) {
  const gitFile = resolve(leafDir, '.git');
  const markerFile = resolve(leafDir, ORPHAN_MARKER);
  let stat, content;
  try { stat = statSync(gitFile); } catch { return existsSync(markerFile) ? 'orphan' : 'unknown'; }
  if (!stat.isFile()) return existsSync(markerFile) ? 'orphan' : 'unknown';
  try { content = readFileSync(gitFile, 'utf8'); } catch { return existsSync(markerFile) ? 'orphan' : 'unknown'; }
  const m = content.match(/^gitdir:\s*(.+)/m);
  if (!m) return existsSync(markerFile) ? 'orphan' : 'unknown';
  return existsSync(resolve(leafDir, m[1].trim())) ? 'live' : 'orphan';
}

function retryDelete(dir) {
  let lastErr = null;
  try { rmSync(dir, { recursive: true, force: true, maxRetries: DELETE_RETRIES, retryDelay: DELETE_RETRY_MS }); }
  catch (e) { lastErr = (e.message || String(e)).slice(0, 200); }
  return lastErr;
}

// MUST be called from every path that fails to delete a leaf. A recursive delete removes the marker
// before it throws on the held entry, so an unmarked survivor classifies unknown -- which the sweep
// never matches and the report never lists, making the leak permanent and invisible.
function markOrphan(leafDir) {
  try {
    writeFileSync(resolve(leafDir, ORPHAN_MARKER), 'This directory was not fully deleted by pr-review cleanup.\n');
    return null;
  } catch (e) {
    return `marker write failed -- this leaf will not be auto-reclaimed: ${(e.message || String(e)).slice(0, 100)}`;
  }
}

function scanLeaves(base) {
  const leaves = [];
  if (!existsSync(base)) return leaves;
  let repoEntries;
  try { repoEntries = readdirSync(base, { withFileTypes: true }); } catch { return leaves; }
  for (const re of repoEntries) {
    if (!re.isDirectory()) continue;
    const repoDir = resolve(base, re.name);
    let prEntries;
    try { prEntries = readdirSync(repoDir, { withFileTypes: true }); } catch { continue; }
    for (const pe of prEntries) {
      if (!pe.isDirectory()) continue;
      const pd = resolve(repoDir, pe.name);
      let leafEntries;
      try { leafEntries = readdirSync(pd, { withFileTypes: true }); } catch { continue; }
      for (const le of leafEntries) {
        if (le.isDirectory() && LEAF_NAME_RE.test(le.name)) leaves.push(resolve(pd, le.name));
      }
    }
  }
  return leaves;
}

function orphanSweep() {
  const swept = [];
  const remaining = [];
  for (const p of scanLeaves(resolve(process.cwd(), 'pr-review-worktree'))) {
    if (leafState(p) === 'orphan') {
      retryDelete(p);
      if (!existsSync(p)) swept.push(p);
      else { markOrphan(p); remaining.push(p); }
    }
  }
  return { swept, remaining };
}

function countFiles(dir) {
  let files = 0;
  const walk = (d) => {
    const entries = readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) { walk(resolve(d, e.name)); }
      else { files++; }
    }
  };
  try { walk(dir); } catch { return null; }
  return files;
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

if (command === 'cleanup') {
  const removedPaths = [];
  const leakedEntries = [];
  const errors = [];

  if (existsSync(prDir)) {
    let entries = [];
    let enumErr = null;
    try { entries = readdirSync(prDir, { withFileTypes: true }); } catch (e) { enumErr = (e.message || String(e)).slice(0, 200); }
    if (enumErr) {
      errors.push({ path: prDir, error: enumErr });
    } else {
      for (const e of entries.filter((x) => x.isDirectory() && /^worktree(-\d+)?$/.test(x.name))) {
        const leafDir = resolve(prDir, e.name);
        gitTry(['worktree', 'remove', '--force', leafDir]);
        try { rmSync(resolve(leafDir, '.git'), { force: true }); } catch { /* best effort */ }
        const deleteErr = retryDelete(leafDir);
        if (!existsSync(leafDir)) {
          removedPaths.push(leafDir);
        } else {
          const entry = { path: leafDir, remainingFiles: countFiles(leafDir), error: deleteErr || 'directory still exists after delete (cause unknown)' };
          const markerErr = markOrphan(leafDir);
          if (markerErr) entry.markerError = markerErr;
          leakedEntries.push(entry);
        }
      }
    }
  }

  gitTry(['worktree', 'prune', '--expire=now']);
  try { rmdirSync(prDir); } catch { /* non-empty ok */ }
  try { rmdirSync(resolve(process.cwd(), 'pr-review-worktree', repo)); } catch { /* non-empty ok */ }

  const removed = leakedEntries.length === 0 && errors.length === 0;
  const out = { removed, paths: removedPaths };
  if (leakedEntries.length > 0) out.leaked = leakedEntries;
  if (errors.length > 0) out.errors = errors;
  if (!removed) {
    out.hint = 'One or more worktree directories are still on disk -- restart the editor to release held handles so a later setup can reclaim the path.';
  }
  console.log(JSON.stringify(out));
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
mkdirSync(prDir, { recursive: true });

// P4: sweep orphan leaves across all repos before allocating a path
const { swept, remaining: sweepRemaining } = orphanSweep();
for (const p of swept) warnings.push(`orphan sweep deleted: ${p}`);

// P1: allocate a worktree path; candidates worktree, worktree-2, ... worktree-10
const leafCandidates = ['worktree', 'worktree-2', 'worktree-3', 'worktree-4', 'worktree-5',
                        'worktree-6', 'worktree-7', 'worktree-8', 'worktree-9', 'worktree-10'];
let worktree = null;
const blockedCandidates = [];
for (const name of leafCandidates) {
  const candidate = resolve(prDir, name);
  if (!existsSync(candidate)) { worktree = candidate; break; }
  // Unconditional reclaim: an aborted prior run leaves a live registration at the primary path;
  // skipping it would strand the checkout and burn a slot on every subsequent run.
  gitTry(['worktree', 'remove', '--force', candidate]);
  retryDelete(candidate);
  if (!existsSync(candidate)) { worktree = candidate; break; }
  markOrphan(candidate);
  blockedCandidates.push(candidate);
}
if (!worktree) {
  fail(2, `all 10 worktree paths are occupied -- editor handles still held; restart the editor and retry: ${leafCandidates.map((n) => resolve(prDir, n)).join(', ')}`);
}

// Workspace-relative POSIX glob for includePattern (an absolute path there matches nothing).
const searchGlob = relative(process.cwd(), worktree).replace(/\\/g, '/') + '/**';

// Every leaf a delete failed on, from the sweep and from allocation alike -- all are marked, so all
// are reclaimable and all must be reported.
const residualLeaves = [...new Set([...sweepRemaining, ...blockedCandidates])].filter((p) => existsSync(p));
if (residualLeaves.length > 0) {
  warnings.push(`${residualLeaves.length} worktree ${residualLeaves.length === 1 ? 'leaf is' : 'leaves are'} still on disk and visible to git and search -- restart the editor to release held handles; for the same PR a later setup reclaims the path, for other repos or PR ids the orphan sweep reclaims the path once handles are released`);
}
gitTry(['worktree', 'prune', '--expire=now']);

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
  const addErr = add.err.trim();
  let addHint = '';
  if (/already exists|already registered/i.test(addErr)) {
    addHint = ' -- the path is occupied or still registered and setup could not reclaim it; close the editor holding it and retry';
  } else if (/filename too long|max_path|longpaths/i.test(addErr)) {
    addHint = ' -- on Windows a MAX_PATH error needs core.longpaths=true';
  }
  fail(2, `git worktree add failed${addHint}: ${addErr}`);
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

// A failed diff (unresolved origin/{target} after a warned target fetch, or a patch over maxBuffer)
// must NOT masquerade as a clean empty review -- warn so the caller can fall back to fetchDiff.
if (!nameOnly.ok || !patch.ok) {
  const derr = ((patch.err || nameOnly.err || '').trim().split('\n')[0] || '').slice(0, 200);
  warnings.push(`diff for '${range}' failed -- diff.txt / changed-files may be EMPTY and Step 7 would analyze nothing (origin/${target} may be unresolved, or the patch exceeds maxBuffer): ${derr}`);
}

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
  searchGlob,
  outDir,
  diffFile,
  changedFiles: changedList.length,
  additions,
  deletions,
  submoduleBumps,
  enrichment,
  warnings,
  ...(residualLeaves.length > 0 ? { orphans: { count: residualLeaves.length, paths: residualLeaves } } : {}),
}));
