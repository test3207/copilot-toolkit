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
//   - PowerShell -NonInteractive (Windows): Read-Host / Get-Credential THROW instead of pending.
//   - GIT_PAGER=cat / PAGER=cat: git/less/more never opens a pager.
//   - GIT_TERMINAL_PROMPT=0: git refuses to prompt for credentials, fails fast.
//   - Hard wall-clock timeout: the process tree is killed if it overruns the budget.
//   - stdout / stderr go to files, never to a TTY (some tools change behavior on TTY detect).
//
// Exit codes:
//   0     success
//   1+    child process exit code
//   124   timeout (Linux convention)

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const command = arg('--command');
const timeoutSec = Number(arg('--timeout-sec', '60'));
const workingDir = arg('--working-dir', process.cwd());
let outputFile = arg('--output-file');

if (!command) {
  console.error('run-safe: --command is required');
  process.exit(2);
}
if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
  console.error(`run-safe: --timeout-sec must be a positive number, got "${arg('--timeout-sec')}"`);
  process.exit(2);
}

// A zero-byte pwsh.exe on PATH is the WindowsApps execution alias, a reparse point that spawns,
// exits 0 and runs nothing when launched from Node. Never accept it.
function realFile(p) {
  try {
    return fs.statSync(p).size > 0 ? p : null;
  } catch {
    return null;
  }
}

// Resolve an absolute executable rather than letting spawn search PATH: PowerShell 7 ships as an
// MSI (Program Files\PowerShell\7) or as a Store package (Program Files\WindowsApps\...), and only
// one of the two exists on any given machine.
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
    realFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')),
  ];
  const exe = candidates.find(Boolean);
  if (!exe) {
    console.error('run-safe: no PowerShell executable found on PATH, in Program Files\\PowerShell\\7, or in System32.');
    process.exit(2);
  }
  return { exe, args: ['-NonInteractive', '-NoProfile', '-NoLogo', '-Command', command] };
}

const captured = !outputFile;
if (captured) outputFile = path.join(os.tmpdir(), `run-safe-${process.pid}-${Date.now()}.out`);
const errFile = `${outputFile}.err`;

function head(file, lines = 5) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(0, lines).join('\n');
  } catch {
    return '';
  }
}

function cleanup(outFd, errFd) {
  for (const fd of [outFd, errFd]) {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
  if (captured) {
    for (const f of [outputFile, errFile]) {
      try { fs.rmSync(f, { force: true }); } catch { /* best effort */ }
    }
  }
}

const outFd = fs.openSync(outputFile, 'w');
const errFd = fs.openSync(errFile, 'w');

const { exe, args } = resolveShell();
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
      return;
    } catch { /* fall through to the plain kill below */ }
    child.kill();
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  killTree();
}, timeoutSec * 1000);

child.on('error', (err) => {
  clearTimeout(timer);
  console.error(`run-safe: failed to start "${exe}": ${err.message}`);
  cleanup(outFd, errFd);
  process.exitCode = 2;
});

child.on('close', (code, signal) => {
  clearTimeout(timer);

  if (timedOut) {
    console.error(
      `TIMEOUT after ${timeoutSec}s. Likely stuck on an interactive prompt OR genuinely slow.\n` +
        `Command : ${command}\n` +
        `WorkDir : ${workingDir}\n` +
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
    process.stdout.write(fs.readFileSync(outputFile, 'utf8'));
    const errText = fs.readFileSync(errFile, 'utf8');
    if (errText.length > 0) {
      process.stderr.write(`--- stderr ---\n${errText}`);
    }
  }
  cleanup(outFd, errFd);

  // A killed child reports a signal and no code; surface it as a generic failure.
  process.exitCode = code === null ? (signal ? 1 : 0) : code;
});
