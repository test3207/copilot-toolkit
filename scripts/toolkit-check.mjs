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

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const consumerRoot = arg('--consumer-root', '.');
const repo = arg('--repo', 'https://github.com/test3207/copilot-toolkit.git');
const mountPath = arg('--mount-path', '.copilot-toolkit');
const lockFile = arg('--lock-file', '.copilot-toolkit/.sync-lock');

const info = (msg) => console.log(`[toolkit-check] ${msg}`);
const err = (msg) => console.log(`[toolkit-check] ${msg}`);

// Windows needs the extension: without shell:true Node does no PATHEXT resolution.
const GIT = process.platform === 'win32' ? 'git.exe' : 'git';

// Returns null instead of throwing, so callers can treat a non-zero git as "unknown" rather than
// as a fatal error. The two call sites that must be fatal check for null themselves.
function git(args, opts = {}) {
  try {
    return execFileSync(GIT, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      windowsHide: true,
      ...opts,
    });
  } catch {
    return null;
  }
}

if (!fs.existsSync(consumerRoot) || !fs.statSync(consumerRoot).isDirectory()) {
  err(`ConsumerRoot '${consumerRoot}' is not a directory.`);
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
    const tag = /^tag=(.+)$/.exec(line);
    if (tag) currentTag = tag[1].trim();
    const commit = /^commit=(.+)$/.exec(line);
    if (commit) currentCommit = commit[1].trim();
  }
  if (!currentTag) {
    err(`Lockfile '${lockFull}' has no tag= line. Malformed.`);
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
    currentCommit = head ? head.trim() : null;
  }
}

if (!mode) {
  err(`No copilot-toolkit consumer mount detected at '${rootFull}'.`);
  err(`  Expected either '${lockFile}' (sync mode) or a '${mountPath}' entry in .gitmodules (submodule mode).`);
  process.exit(1);
}

// --- upstream tag list ---------------------------------------------------

info(`Querying upstream tags (${repo}) ...`);
const lsRemote = git(['ls-remote', '--tags', '--refs', repo, 'refs/tags/v*']);
if (lsRemote === null) {
  err('git ls-remote failed. Check network / repo URL.');
  process.exit(1);
}

const upstreamTags = [];
for (const line of lsRemote.split(/\r?\n/)) {
  const m = /^[0-9a-f]+\s+refs\/tags\/(v\d+\.\d+\.\d+)$/.exec(line);
  if (m) upstreamTags.push(m[1]);
}

if (upstreamTags.length === 0) {
  err('Upstream has no vX.Y.Z tags. Check the repo URL.');
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
  process.exit(0);
}

const pinnedIndex = sorted.indexOf(currentTag);
if (pinnedIndex < 0) {
  console.log(`Status        : DIVERGED -- pinned tag '${currentTag}' is not in the upstream tag list.`);
  console.log('                (Possible reasons: tag deleted upstream; consumer pinned to a pre-release / fork tag.)');
  console.log('');
  console.log('Latest 5 upstream tags:');
  for (const t of sorted.slice(0, 5)) console.log(`  ${t}`);
  process.exit(0);
}

const behind = sorted.slice(0, pinnedIndex);
console.log(`Status        : BEHIND BY ${behind.length} TAG(S)`);
console.log('');
console.log('Tags between pinned and latest (newest first):');
for (const t of behind) console.log(`  ${t}`);

console.log('');
console.log('To upgrade:');
if (mode === 'sync') {
  console.log(`  pwsh -File ${mountPath}/install/sync.ps1 -Tag ${latest}`);
  console.log(`  git add ${mountPath}`);
  console.log(`  git commit -m "Sync copilot-toolkit -> ${latest}"`);
} else {
  console.log(`  git -C ${mountPath} fetch --tags`);
  console.log(`  git -C ${mountPath} checkout ${latest}`);
  console.log(`  git add ${mountPath}`);
  console.log(`  git commit -m "Upgrade copilot-toolkit submodule -> ${latest}"`);
}
