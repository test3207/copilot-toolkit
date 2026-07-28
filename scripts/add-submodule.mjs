#!/usr/bin/env node
// add-submodule.mjs -- deterministic submodule mount for onboard-repo Step 2.
//
// Runs the fixed git sequence that adds a repo as a submodule under repos/<name>,
// marks it ignore=all, and pins its tracking branch -- so the onboard recipe is one
// tested `node` call instead of a multi-line pwsh block that breaks on cross-platform
// quoting. git is invoked via execFileSync with an args ARRAY (no shell), so clone
// URLs / branch names with special chars carry no escaping hazard.
//
// Usage:
//   node add-submodule.mjs --name <repoName> --clone-url <url> --branch <branch>
//
// stdout = one JSON object: { name, path, cloneUrl, branch }
// Exit codes: 0 ok | 1 usage / precondition error | 2 git failure.

import { execFileSync } from 'node:child_process';

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : undefined;
}

function fail(code, message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(code);
}

const name = arg('--name');
const cloneUrl = arg('--clone-url');
const branch = arg('--branch');

if (!name || !cloneUrl || !branch) fail(1, '--name, --clone-url, and --branch are required');
// `name` becomes a path segment (repos/<name>) AND a .gitmodules key -- reject separators / traversal.
if (/[\\/]|\.\./.test(name)) fail(1, '--name must not contain path separators or ".."');

const path = `repos/${name}`;

function git(args) {
  return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

try {
  git(['submodule', 'add', '--name', name, cloneUrl, path]);
  git(['config', '-f', '.gitmodules', `submodule.${name}.ignore`, 'all']);
  git(['config', '-f', '.gitmodules', `submodule.${name}.branch`, branch]);
} catch (e) {
  fail(2, `git failed: ${(e.stderr || e.message || '').toString().trim()}`);
}

process.stdout.write(`${JSON.stringify({ name, path, cloneUrl, branch })}\n`);
