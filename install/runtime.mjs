import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const skills = {
  'coding-standards': ['SKILL.md', 'common.md', 'csharp.md', 'typescript.md'],
  'dep-audit': ['SKILL.md'],
  'distill-submodule-rules': ['SKILL.md'],
  'onboard-repo': ['SKILL.md', 'providers/_index.md', 'providers/ado.md', 'providers/github.md', 'providers/generic-git.md'],
  'pr-review': [
    'SKILL.md', 'workflow.md', 'reference.md', 'rules.md', 'tags.md', 'decision.md',
    'steps/prep.md', 'steps/analyze.md', 'steps/finalize.md',
    'providers/_index.md', 'providers/ado.md', 'providers/github.md',
    'anti-patterns/index.md', 'anti-patterns/async-types.md', 'anti-patterns/control-flow.md',
    'anti-patterns/semantic.md', 'anti-patterns/lang/typescript-react.md',
  ],
  'tool-dev': ['SKILL.md', 'context-engineering.md', 'subagent-design.md', 'update-design-gate.md'],
  'work': ['SKILL.md', 'shared.md', 'feature.md', 'bugfix.md', 'closure-validation.md',
    'anti-patterns/design.md', 'providers/_index.md', 'providers/ado.md', 'providers/github.md'],
};

export const runtimeFiles = [
  ...['dep', 'onboard-repo', 'pr-review', 'tool-dev', 'work'].map(name => `.github/prompts/${name}.prompt.md`),
  ...['_template', 'pr-finding-validator', 'pr-impact-analyzer', 'pr-logic-reviewer',
    'pr-quality-checker', 'work-architect-explorer', 'work-closure-detail-validator',
    'work-closure-direction-validator', 'work-impact-tracer', 'work-implementer',
    'work-rca-tracer'].map(name => `.github/agents/${name}.md`),
  ...Object.entries(skills).flatMap(([name, files]) => files.map(file => `.github/skills/${name}/${file}`)),
  ...['parse-input', 'derive-repo-context', 'preflight', 'pr-review-config',
    'pr-review-worktree', 'pr-review-assemble', 'ado-rest', 'github-rest',
    'parse-git-remote', 'add-submodule', 'run-safe', 'lint-recipes'].map(name => `scripts/${name}.mjs`),
  'templates/_template.prompt.md', 'templates/copilot-instructions.template.md',
  'templates/template-skill/SKILL.md', 'LICENSE',
].sort();

export const bootstrapFiles = [
  'install/init.mjs', 'install/runtime.mjs',
  ...['package.json', 'LICENSE.md', 'README.md', 'NOTICE.md', 'lib/umd/main.js', 'lib/umd/main.d.ts',
    ...['edit', 'format', 'parser', 'scanner', 'string-intern'].map(name => `lib/umd/impl/${name}.js`),
  ].map(file => `install/vendor/jsonc-parser/${file}`),
].sort();

export const payloadPaths = [...runtimeFiles.map(file => `build/${file}`), ...bootstrapFiles].sort();
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const identity = entries => hash(Buffer.from(JSON.stringify(entries)));

export function safePath(root, relative = '') {
  if (relative && (relative.includes('\\') || relative.split('/').some(part =>
    !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part) || /[. ]$/.test(part)))) {
    throw new Error('Unsafe package path');
  }
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relative);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Path escapes root');
  let current = target;
  for (;;) {
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error('Linked input or target');
    if (stat && current !== target && !stat.isDirectory()) throw new Error('Non-directory ancestor');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return target;
}

export function readBytes(root, relative) {
  const target = safePath(root, relative);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Non-regular or linked input: ${relative}`);
  return fs.readFileSync(target);
}

export function writeBytes(root, relative, bytes) {
  const target = safePath(root, relative);
  if (fs.existsSync(target)) readBytes(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

function validate(root, completePackage) {
  const manifest = JSON.parse(readBytes(root, 'build/provenance.json'));
  if (manifest.version !== 1 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(manifest.sourceCommit)
    || typeof manifest.dirty !== 'boolean') throw new Error('Invalid provenance');
  for (const key of ['inputs', 'payload']) {
    const entries = manifest[key];
    if (!Array.isArray(entries) || entries.some(entry => typeof entry.path !== 'string'
      || !/^[a-f0-9]{64}$/.test(entry.sha256))) throw new Error('Invalid hash entries');
    const names = entries.map(entry => entry.path);
    for (const name of names) {
      if (completePackage || name.startsWith('build/')) safePath(root, name);
    }
    if (JSON.stringify(names) !== JSON.stringify([...new Set(names)].sort())) throw new Error('Unsorted or duplicate paths');
    if (manifest[`${key}Hash`] !== identity(entries)) throw new Error('Invalid identity');
  }
  if (completePackage && JSON.stringify(manifest.payload.map(entry => entry.path)) !== JSON.stringify(payloadPaths)) {
    throw new Error('Incomplete or unexpected package payload');
  }
  const runtimePayload = manifest.payload.filter(entry => entry.path.startsWith('build/'));
  if (!runtimePayload.length) throw new Error('Incomplete runtime');
  for (const entry of completePackage ? manifest.payload : runtimePayload) {
    if (hash(readBytes(root, entry.path)) !== entry.sha256) throw new Error(`Altered package file: ${entry.path}`);
  }
  const expected = new Set([...runtimePayload.map(entry => entry.path.slice(6)), 'provenance.json']);
  function visit(relative = '') {
    for (const name of fs.readdirSync(safePath(root, relative ? `build/${relative}` : 'build'))) {
      const child = relative ? `${relative}/${name}` : name;
      const target = safePath(root, `build/${child}`);
      if (child === '.gitignore') {
        if (!readBytes(root, 'build/.gitignore').equals(Buffer.from('*\n'))) throw new Error('Invalid local runtime ignore');
      } else if (fs.lstatSync(target).isDirectory()) visit(child);
      else if (!expected.delete(child)) throw new Error(`Unexpected runtime file: ${child}`);
    }
  }
  visit();
  if (expected.size) throw new Error('Incomplete runtime');
  for (const entry of manifest.payload) {
    const inputPath = entry.path.startsWith('build/') ? entry.path.slice(6) : entry.path;
    if (manifest.inputs.find(input => input.path === inputPath)?.sha256 !== entry.sha256) throw new Error('Input/payload identity mismatch');
  }
  return manifest;
}

export function validatePackage(root) {
  return validate(root, true);
}

export function validateActiveRuntime(root) {
  return validate(root, false);
}

export function activateRuntime({ mount, candidate, settings, fault = () => {} }) {
  validatePackage(candidate || mount);
  const active = safePath(mount, 'build');
  const backupRoot = fs.mkdtempSync(path.join(safePath(mount), '.runtime-backup-'));
  writeBytes(backupRoot, '.gitignore', '*\n');
  let moved = false;
  let installed = false;
  let settingsAttempted = false;
  try {
    if (settings && settings.before !== null) writeBytes(backupRoot, 'settings.json', settings.before);
    fault('before-activate');
    if (candidate && fs.existsSync(active)) {
      fs.renameSync(active, path.join(backupRoot, 'build'));
      moved = true;
    }
    if (candidate) {
      fault('activate');
      fs.renameSync(safePath(candidate, 'build'), active);
      installed = true;
    }
    if (settings) {
      settingsAttempted = true;
      fault('settings-write');
      settings.write();
    }
    validatePackage(mount);
  } catch (error) {
    try {
      fault('restore');
      if (settingsAttempted) settings.restore();
      if (installed) fs.rmSync(active, { recursive: true, force: true });
      if (moved) fs.renameSync(path.join(backupRoot, 'build'), active);
    } catch {
      throw new Error(`Activation failed; restoration failed. Recovery backup retained: ${backupRoot}`, { cause: error });
    }
    fs.rmSync(backupRoot, { recursive: true, force: true });
    throw new Error(`Activation failed; previous runtime ${moved ? 'restored' : 'unchanged or absent'}`, { cause: error });
  }
  fs.rmSync(backupRoot, { recursive: true, force: true });
}