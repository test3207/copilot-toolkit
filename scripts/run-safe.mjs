#!/usr/bin/env node
// Run a command with hard timeout + closed stdin + pager defang.
// Subagents and ad-hoc scripts call this instead of running raw commands so a
// pager / Read-Host / Get-Credential prompt cannot make the process hang.
//
// Usage:
//   node scripts/run-safe.mjs --command "git --no-pager log --oneline -- src/foo.ts" --timeout-sec 30
//   node scripts/run-safe.mjs --command "git show abc123" --output-file raw/diff.txt --timeout-sec 60
//   node scripts/run-safe.mjs --command "az account show" --timeout-sec 15
//
// What it guarantees about the child process:
//   - stdin is closed: any prompt reaches EOF and fails instead of pending.
//   - PowerShell 7 -NonInteractive (Windows): Read-Host / Get-Credential THROW instead of pending.
//     Windows PowerShell 5.1 is never used as a fallback; if pwsh 7 is absent this exits 2.
//   - On POSIX the child shell is /bin/sh -c, which has no -NonInteractive equivalent; the closed
//     stdin and the timeout are what carry the guarantee there.
//   - GIT_PAGER=cat / PAGER=cat: git/less/more never opens a pager.
//   - GIT_TERMINAL_PROMPT=0: git refuses to prompt for credentials, fails fast.
//   - Hard wall-clock timeout: the process tree is killed if it overruns the budget.
//   - stdout / stderr go to files, never to a TTY (some tools change behavior on TTY detect).
//
// Exit codes:
//   0     success
//   1+    child process exit code
//   2     wrapper error (bad usage, or no PowerShell 7 on Windows). Ambiguous with a child that
//         itself exits 2; wrapper errors always print a line prefixed "run-safe:" to stderr.
//   124   timeout (Linux convention)

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FLAGS = new Set(['--command', '--timeout-sec', '--working-dir', '--output-file']);

function usage(message) {
  console.error(`run-safe: ${message}`);
  process.exit(2);
}

// PowerShell's parameter binder rejected an unknown or valueless parameter; silently falling back
// to a default would run the child under settings the caller did not ask for.
function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return def;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) usage(`${flag} requires a value.`);
  return value;
}

for (let i = 2; i < process.argv.length; i++) {
  const token = process.argv[i];
  if (!token.startsWith('--')) {
    usage(`unexpected argument "${token}". Quote the whole command: --command "git status"`);
  }
  if (!FLAGS.has(token)) usage(`unknown option "${token}". Known options: ${[...FLAGS].join(', ')}.`);
  i++;
}

const command = arg('--command');
const timeoutSec = Number(arg('--timeout-sec', '60'));
const workingDir = arg('--working-dir', process.cwd());
let outputFile = arg('--output-file');

if (!command) usage('--command is required.');
if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
  usage(`--timeout-sec must be a positive number, got "${arg('--timeout-sec')}".`);
}

// A pwsh.exe that cannot be stat'ed or reports zero bytes is the WindowsApps execution alias, a
// reparse point that spawns, exits 0 and runs nothing when launched from Node. Never accept it.
function realFile(p) {
  try {
    return fs.statSync(p).size > 0 ? p : null;
  } catch {
    return null;
  }
}

// PowerShell 7 ships as an MSI under Program Files\PowerShell\7 or as a Store package under
// Program Files\WindowsApps. Both put a real pwsh.exe on PATH -- the Store installer adds its
// versioned package directory, and Program Files\WindowsApps itself cannot be enumerated by a
// normal process (EPERM), so scanning PATH is the only way to reach the Store layout. Windows
// PowerShell 5.1 is deliberately NOT a fallback: the script this replaced spawned `pwsh`, so
// accepting 5.1 would silently run the caller's command under a different language version.
function resolveShell() {
  if (process.platform !== 'win32') {
    return { exe: '/bin/sh', args: ['-c', command] };
  }
  const onPath = (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((d) => realFile(path.join(d, 'pwsh.exe')));
  const candidates = [
    ...onPath,
    realFile(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')),
  ];
  const exe = candidates.find(Boolean);
  if (!exe) {
    console.error(
      'run-safe: PowerShell 7 not found. Looked for a non-empty pwsh.exe on every PATH entry\n' +
        '  (this is what reaches a Store install) and in Program Files\\PowerShell\\7 (MSI install).\n' +
        '  Install PowerShell 7: winget install Microsoft.PowerShell.'
    );
    process.exit(2);
  }
  return { exe, args: ['-NonInteractive', '-NoProfile', '-NoLogo', '-Command', command] };
}

// Resolve before creating anything: the exit-2 path above must not have truncated the caller's
// --output-file or left a temp directory behind for a child that never ran.
const { exe, args } = resolveShell();

const captured = !outputFile;
// A private directory, not a guessable name in a shared /tmp: opening a predictable path with 'w'
// follows a pre-planted symlink and truncates its target.
const tempDir = captured ? fs.mkdtempSync(path.join(os.tmpdir(), 'run-safe-')) : null;
if (captured) outputFile = path.join(tempDir, 'out');
const errFile = `${outputFile}.err`;

// Bounded read: the timeout exists to contain runaway output, so the diagnostic must not try to
// load it all just to print five lines.
function head(file, lines = 5, bytes = 8192) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, read).toString('utf8').split(/\r?\n/).slice(0, lines).join('\n');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

function cleanup(outFd, errFd) {
  for (const fd of [outFd, errFd]) {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
  if (captured) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

let outFd;
let errFd;
try {
  outFd = fs.openSync(outputFile, 'w');
  errFd = fs.openSync(errFile, 'w');
} catch (e) {
  usage(`cannot open output file "${outputFile}": ${e.message}`);
}

const child = spawn(exe, args, {
  cwd: workingDir,
  // Defanged interactive surfaces are inherited by the child via process env.
  env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', PAGER: 'cat', LESS: '-FRX' },
  stdio: ['ignore', outFd, errFd],
  windowsHide: true,
  // A POSIX process group lets the timeout kill grandchildren too.
  detached: process.platform !== 'win32',
});

function killTree() {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
      return true;
    } catch { /* fall through to the plain kill below */ }
    child.kill();
    return false;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
    return true;
  } catch {
    child.kill('SIGKILL');
    return false;
  }
}

let timedOut = false;
let treeKilled = true;
const timer = setTimeout(() => {
  timedOut = true;
  treeKilled = killTree();
}, timeoutSec * 1000);

// `detached` puts the POSIX child in its own process group, so it no longer receives the
// terminal's Ctrl+C. Without this the wrapper would exit on SIGINT and leave the tree running,
// which is the containment it exists to provide.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    clearTimeout(timer);
    killTree();
    cleanup(outFd, errFd);
    process.exit(128 + (sig === 'SIGINT' ? 2 : 15));
  });
}

// 'close' still fires after 'error', so without this the spawn-failure exit code is clobbered and
// the close path reads files cleanup() has already removed.
let errored = false;
child.on('error', (err) => {
  errored = true;
  clearTimeout(timer);
  console.error(`run-safe: failed to start "${exe}": ${err.message}`);
  cleanup(outFd, errFd);
  process.exitCode = 2;
});

child.on('close', (code, signal) => {
  if (errored) return;
  clearTimeout(timer);

  if (timedOut) {
    console.error(
      `TIMEOUT after ${timeoutSec}s. Likely stuck on an interactive prompt OR genuinely slow.\n` +
        `Command : ${command}\n` +
        `WorkDir : ${workingDir}\n` +
        (treeKilled ? '' : 'WARNING : could not kill the process tree; grandchildren may still be running.\n') +
        `--- partial stdout (head) ---\n${head(outputFile)}\n` +
        `--- partial stderr (head) ---\n${head(errFile)}`
    );
    cleanup(outFd, errFd);
    process.exitCode = 124;
    return;
  }

  if (captured) {
    try { fs.closeSync(outFd); } catch { /* already closed */ }
    try { fs.closeSync(errFd); } catch { /* already closed */ }
    const outText = fs.readFileSync(outputFile, 'utf8');
    process.stdout.write(outText);
    const errText = fs.readFileSync(errFile, 'utf8');
    if (errText.length > 0) {
      // The PowerShell version wrote this block with Write-Host, i.e. to stdout and always on a
      // fresh line. Keep both, so a caller redirecting stdout to a file still captures stderr and
      // the heading never runs into the last line of stdout.
      const sep = outText.length > 0 && !outText.endsWith('\n') ? '\n' : '';
      process.stdout.write(`${sep}--- stderr ---\n${errText}`);
    }
  }
  cleanup(outFd, errFd);

  // A killed child reports a signal and no code; surface it as a generic failure.
  process.exitCode = code === null ? (signal ? 1 : 0) : code;
});
