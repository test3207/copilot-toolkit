import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runtimeFiles, bootstrapFiles, hash, identity, safePath, readBytes, writeBytes,
  validatePackage, validateActiveRuntime, activateRuntime } from '../install/runtime.mjs';

const buildInputs = ['scripts/build.mjs'];

export function snapshotInputs(sourceRoot) {
  return new Map([...runtimeFiles, ...bootstrapFiles, ...buildInputs].sort()
    .map(relative => [relative, readBytes(sourceRoot, relative)]));
}

function git(sourceRoot, args) {
  const result = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', ['--no-pager', ...args], {
    cwd: sourceRoot, encoding: 'utf8', timeout: 10000, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error || result.status !== 0) throw new Error('Source provenance requires a readable Git checkout');
  return result.stdout.trim();
}

export async function stageBuild({ sourceRoot, stagingParent, fault = () => {} }) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or newer is required');
  const checkout = fs.realpathSync.native(git(sourceRoot, ['rev-parse', '--show-toplevel']));
  const selected = fs.realpathSync.native(safePath(sourceRoot));
  if ((process.platform === 'win32' ? checkout.toLowerCase() : checkout) !==
    (process.platform === 'win32' ? selected.toLowerCase() : selected)) {
    throw new Error('Build requires the toolkit source checkout, not a consumer parent checkout');
  }
  const inputs = snapshotInputs(sourceRoot);
  const sourceCommit = git(sourceRoot, ['rev-parse', '--verify', 'HEAD']);
  const dirty = git(sourceRoot, ['status', '--porcelain', '--untracked-files=all', '--', ...inputs.keys()]) !== '';
  const root = fs.mkdtempSync(path.join(safePath(stagingParent), '.toolkit-stage-'));
  try {
    writeBytes(root, '.gitignore', '*\n');
    const payload = [];
    for (const [relative, bytes] of inputs) {
      if (buildInputs.includes(relative)) continue;
      const target = bootstrapFiles.includes(relative) ? relative : `build/${relative}`;
      writeBytes(root, target, bytes);
      payload.push({ path: target, sha256: hash(bytes) });
    }
    payload.sort((left, right) => left.path < right.path ? -1 : 1);
    const inputEntries = [...inputs].map(([relative, bytes]) => ({ path: relative, sha256: hash(bytes) }));
    const manifest = { version: 1, sourceCommit, dirty, inputs: inputEntries, inputsHash: identity(inputEntries),
      payload, payloadHash: identity(payload) };
    writeBytes(root, 'build/.gitignore', '*\n');
    writeBytes(root, 'build/provenance.json', `${JSON.stringify(manifest, null, 2)}\n`);
    fault('staged', root);
    validatePackage(root);
    return { root, manifest };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export async function build({ sourceRoot = fileURLToPath(new URL('../', import.meta.url)), fault } = {}) {
  const candidate = await stageBuild({ sourceRoot, stagingParent: sourceRoot, fault });
  try {
    activateRuntime({ mount: sourceRoot, candidate: candidate.root, fault });
    return candidate.manifest;
  } finally {
    fs.rmSync(candidate.root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) {
    console.error('Usage: node scripts/build.mjs');
    process.exitCode = 2;
  } else {
    const mount = fileURLToPath(new URL('../', import.meta.url));
    let previous;
    try { previous = validateActiveRuntime(mount); } catch {}
    try {
      const manifest = await build();
      console.log(`Runtime built: ${manifest.sourceCommit} ${manifest.inputsHash}; discovery unchanged. Run install/init.mjs to initialize.`);
    } catch (error) {
      let available = false;
      try {
        const current = validateActiveRuntime(mount);
        available = Boolean(previous && current.inputsHash === previous.inputsHash && current.payloadHash === previous.payloadHash);
      } catch {}
      console.error(`Build failed; this attempt is not ready. Valid runtime available: ${available}. ${error.message}`);
      process.exitCode = 1;
    }
  }
}