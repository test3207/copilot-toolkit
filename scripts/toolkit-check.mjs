#!/usr/bin/env node
// Report whether a consumer repo's pinned copilot-toolkit version is behind upstream.
//
// Read-only check. Auto-detects which distribution mode the consumer uses for the
// .copilot-toolkit/ mount and prints the currently pinned tag, the latest upstream release tag,
// and any intermediate tags between them.
//
// Mode detection (in order):
//   sync       - the lockfile exists at the consumer root
//   submodule  - .gitmodules at the consumer root has a mount-path entry
//   none       - neither marker found (error)
//
// The script never mutates anything. It does not pull, fetch, sync, update submodule pointers,
// write release notes, or change configuration. It is safe to run from any shell at any time.
//
// Sync mode by design carries no upstream awareness in the consumer's daily workflow -- only the
// operator who already knows the upstream URL should run this script. That is why this is a
// maintainer-side check, not an automated gate.
//
// Usage:
//   node scripts/toolkit-check.mjs
//   node scripts/toolkit-check.mjs --consumer-root C:\dev\codeSmith
//
// Options:
//   --consumer-root <path>  consumer repo root (the directory containing the mount). Default '.'.
//   --repo <url>            upstream git URL. Default the canonical copilot-toolkit repo.
//   --mount-path <path>     mount directory inside the consumer repo. Default '.copilot-toolkit'.
//   --lock-file <path>      sync-mode lockfile inside the consumer repo.
//                           Default '.copilot-toolkit/.sync-lock'.
//
// Exit codes:
//   0    success (report printed; check the output for behind-ness)
//   1    error (no consumer mount detected, git failure, malformed lockfile)
//   2    bad usage (invalid parameter)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FLAGS = new Set(['--consumer-root', '--repo', '--mount-path', '--lock-file']);

function usage(message) {
  console.error(`[toolkit-check] ${message}`);
  process.exit(2);
}

// PowerShell's parameter binder rejected an unknown or valueless parameter, and this script
// documents exit 2 for exactly that.
function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return def;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) usage(`${flag} requires a value.`);
  return value;
}

for (let i = 2; i < process.argv.length; i++) {
  const token = process.argv[i];
  if (!token.startsWith('--')) usage(`unexpected argument "${token}". Did you mean --consumer-root ${token}?`);
  if (!FLAGS.has(token)) usage(`unknown option "${token}". Known options: ${[...FLAGS].join(', ')}.`);
  i++;
}

const consumerRoot = arg('--consumer-root', '.');
const repo = arg('--repo', 'https://github.com/test3207/copilot-toolkit.git');
const mountPath = arg('--mount-path', '.copilot-toolkit');
const lockFile = arg('--lock-file', '.copilot-toolkit/.sync-lock');

// Everything this script prints is a report for a human, on stdout, as Write-Host was.
const say = (msg) => console.log(`[toolkit-check] ${msg}`);

// Returns null instead of throwing, so callers can treat a non-zero git as "unknown" rather than
// as a fatal error. The two call sites that must be fatal check for null themselves.
let lastGitStatus = 0;
let gitMissing = false;
let gitTimedOut = false;
function git(args, opts = {}) {
  try {
    const out = execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      windowsHide: true,
      // An unreachable or auth-prompting remote must not hang the check.
      timeout: 60000,
      ...opts,
    });
    lastGitStatus = 0;
    return out;
  } catch (e) {
    if (e.code === 'ENOENT') gitMissing = true;
    // execFileSync reports a timeout by killing the child, so there is a signal and no exit code.
    gitTimedOut = e.code === 'ETIMEDOUT' || (e.signal != null && e.status == null);
    lastGitStatus = typeof e.status === 'number' ? e.status : 1;
    return null;
  }
}

if (!fs.existsSync(consumerRoot) || !fs.statSync(consumerRoot).isDirectory()) {
  say(`ConsumerRoot '${consumerRoot}' is not a directory.`);
  process.exit(2);
}

const rootFull = fs.realpathSync(path.resolve(consumerRoot));
const lockFull = path.join(rootFull, lockFile);
const mountFull = path.join(rootFull, mountPath);
const gmFull = path.join(rootFull, '.gitmodules');

const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();

// --- mode detection ------------------------------------------------------

let mode = null;
let currentTag = null;
let currentCommit = null;

if (isFile(lockFull)) {
  mode = 'sync';
  for (const line of fs.readFileSync(lockFull, 'utf8').split(/\r?\n/)) {
    if (line === '---') break;
    // PowerShell -match is case-insensitive by default; keep that.
    const tag = /^tag=(.+)$/i.exec(line);
    if (tag) currentTag = tag[1].trim();
    const commit = /^commit=(.+)$/i.exec(line);
    if (commit) currentCommit = commit[1].trim();
  }
  if (!currentTag) {
    say(`Lockfile '${lockFull}' has no tag= line. Malformed.`);
    process.exit(1);
  }
} else if (isFile(gmFull) && isDir(mountFull)) {
  const key = `^submodule\\.${mountPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.path$`;
  if (git(['config', '-f', gmFull, '--get-regexp', key])) {
    mode = 'submodule';
    const describe =
      git(['describe', '--tags', '--exact-match'], { cwd: mountFull }) ||
      git(['describe', '--tags'], { cwd: mountFull });
    currentTag = describe ? describe.trim() : '<unknown>';
    const head = git(['rev-parse', '--short', 'HEAD'], { cwd: mountFull });
    // The PowerShell version threw here when rev-parse produced nothing, which is the right
    // outcome: an uninitialized submodule has no pinned version to report on, and continuing
    // would print a confident DIVERGED for a mount that is not usable.
    if (head === null) {
      say(`'${mountFull}' is registered in .gitmodules but has no checked-out commit.`);
      say('  Run: git submodule update --init');
      process.exit(1);
    }
    currentCommit = head.trim();
  }
}

if (!mode) {
  if (gitMissing) {
    say('git was not found on PATH, so submodule mode could not be detected.');
    process.exit(1);
  }
  say(`No copilot-toolkit consumer mount detected at '${rootFull}'.`);
  say(`  Expected either '${lockFile}' (sync mode) or a '${mountPath}' entry in .gitmodules (submodule mode).`);
  process.exit(1);
}

// --- upstream tag list ---------------------------------------------------

say(`Querying upstream tags (${repo}) ...`);
const lsRemote = git(['ls-remote', '--tags', '--refs', repo, 'refs/tags/v*']);
if (lsRemote === null) {
  if (gitMissing) say('git was not found on PATH.');
  else if (gitTimedOut) say('git ls-remote timed out after 60s. The remote is unreachable or is waiting for credentials.');
  else say(`git ls-remote failed (exit ${lastGitStatus}). Check network / repo URL.`);
  process.exit(1);
}

const upstreamTags = [];
for (const line of lsRemote.split(/\r?\n/)) {
  const m = /^[0-9a-f]+\s+refs\/tags\/(v\d+\.\d+\.\d+)$/i.exec(line);
  if (m) upstreamTags.push(m[1]);
}

if (upstreamTags.length === 0) {
  say('Upstream has no vX.Y.Z tags. Check the repo URL.');
  process.exit(1);
}

const parts = (t) => t.slice(1).split('.').map(Number);
const sorted = upstreamTags.slice().sort((a, b) => {
  const [pa, pb] = [parts(a), parts(b)];
  return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2];
});
const latest = sorted[0];

// --- compare + report ----------------------------------------------------

console.log('');
console.log(`Consumer root : ${rootFull}`);
console.log(`Mode          : ${mode}`);
console.log(`Pinned tag    : ${currentTag} (${currentCommit})`);
console.log(`Upstream HEAD : ${latest}`);

if (currentTag === latest) {
  console.log('Status        : UP TO DATE');
} else if (sorted.indexOf(currentTag) < 0) {
  console.log(`Status        : DIVERGED -- pinned tag '${currentTag}' is not in the upstream tag list.`);
  console.log('                (Possible reasons: tag deleted upstream; consumer pinned to a pre-release / fork tag.)');
  console.log('');
  console.log('Latest 5 upstream tags:');
  for (const t of sorted.slice(0, 5)) console.log(`  ${t}`);
} else {
  const behind = sorted.slice(0, sorted.indexOf(currentTag));
  console.log(`Status        : BEHIND BY ${behind.length} TAG(S)`);
  console.log('');
  console.log('Tags between pinned and latest (newest first):');
  for (const t of behind) console.log(`  ${t}`);

  console.log('');
  console.log('To upgrade:');
  if (mode === 'sync') {
    // The port removed the implicit guarantee that the reader has pwsh, so name the runnable one.
    console.log(
      process.platform === 'win32'
        ? `  pwsh -File ${mountPath}/install/sync.ps1 -Tag ${latest}`
        : `  bash ${mountPath}/install/sync.sh --tag ${latest}`
    );
    console.log(`  git add ${mountPath}`);
    console.log(`  git commit -m "Sync copilot-toolkit -> ${latest}"`);
  } else {
    console.log(`  git -C ${mountPath} fetch --tags`);
    console.log(`  git -C ${mountPath} checkout ${latest}`);
    console.log(`  git add ${mountPath}`);
    console.log(`  git commit -m "Upgrade copilot-toolkit submodule -> ${latest}"`);
  }
}
