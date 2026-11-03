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
  'install/init.mjs', 'install/runtime.mjs', 'install/copilot.mjs',
  ...['package.json', 'LICENSE', 'README.md', 'NOTICE.md', 'dist/js-yaml.mjs']
    .map(file => `install/vendor/js-yaml/${file}`),
  ...['package.json', 'LICENSE.md', 'README.md', 'NOTICE.md', 'lib/umd/main.js', 'lib/umd/main.d.ts',
    ...['edit', 'format', 'parser', 'scanner', 'string-intern'].map(name => `lib/umd/impl/${name}.js`),
  ].map(file => `install/vendor/jsonc-parser/${file}`),
].sort();

const legacyBootstrap = bootstrapFiles.filter(file => file !== 'install/copilot.mjs' && !file.startsWith('install/vendor/js-yaml/'));
export const transformRevision = 'copilot-r5-1';
export const copilotSources = new Map([
  ['build/copilot/plugin/plugin.json', null],
  ...runtimeFiles.flatMap(file => {
    const prompt = /^\.github\/prompts\/([^/]+)\.prompt\.md$/.exec(file);
    const agent = /^\.github\/agents\/([^/]+)\.md$/.exec(file);
    const skill = /^\.github\/skills\/([^/]+)\/(.+)$/.exec(file);
    if (prompt) return [[`build/copilot/plugin/skills/${prompt[1]}/SKILL.md`, file]];
    if (agent && agent[1] !== '_template') return [[`build/copilot/agents/${agent[1]}.agent.md`, file]];
    if (skill) {
      const alias = ['work', 'pr-review', 'onboard-repo', 'tool-dev'].includes(skill[1]) ? `${skill[1]}-internal` : skill[1];
      return [[`build/copilot/plugin/skills/${alias}/${skill[2]}`, file]];
    }
    return [];
  }),
].sort(([left], [right]) => left < right ? -1 : 1));
export function copilotDerivations() {
  const dependencies = ['install/copilot.mjs', 'install/runtime.mjs', 'scripts/build.mjs',
    ...bootstrapFiles.filter(file => file.startsWith('install/vendor/js-yaml/'))];
  return [...copilotSources].map(([output, source]) => ({ path: output,
    inputs: [...dependencies, ...(source ? [source] : [])].sort(), transform: transformRevision }));
}
export const payloadPaths = [...runtimeFiles.map(file => `build/${file}`), ...bootstrapFiles, ...copilotSources.keys()].sort();
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

export function removeTree(root) {
  const target = safePath(root);
  if (!fs.existsSync(target)) return;
  for (const name of fs.readdirSync(target)) {
    const child = safePath(target, name);
    if (fs.lstatSync(child).isDirectory()) removeTree(child);
    else fs.unlinkSync(child);
  }
  fs.rmdirSync(target);
}

function validate(root, completePackage) {
  const manifest = JSON.parse(readBytes(root, 'build/provenance.json'));
  if (![1, 2].includes(manifest.version) || typeof manifest.sourceCommit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(manifest.sourceCommit)
    || typeof manifest.dirty !== 'boolean') throw new Error('Invalid provenance');
  for (const key of ['inputs', 'payload']) {
    const entries = manifest[key];
    if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry.path !== 'string'
      || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256))) throw new Error('Invalid hash entries');
    const names = entries.map(entry => entry.path);
    for (const name of names) {
      if (completePackage || name.startsWith('build/')) safePath(root, name);
    }
    if (JSON.stringify(names) !== JSON.stringify([...new Set(names)].sort())
      || new Set(names.map(name => name.toLowerCase())).size !== names.length) throw new Error('Unsorted or duplicate paths');
    if (manifest[`${key}Hash`] !== identity(entries)) throw new Error('Invalid identity');
  }
  const bootstrap = manifest.version === 1 ? legacyBootstrap : bootstrapFiles;
  const expectedPayload = manifest.version === 1 ? [...runtimeFiles.map(file => `build/${file}`), ...bootstrap].sort() : payloadPaths;
  if (completePackage && JSON.stringify(manifest.payload.map(entry => entry.path)) !== JSON.stringify(expectedPayload)) {
    throw new Error('Incomplete or unexpected package payload');
  }
  if (completePackage && JSON.stringify(manifest.inputs.map(entry => entry.path)) !==
    JSON.stringify([...runtimeFiles, ...bootstrap, 'scripts/build.mjs'].sort())) throw new Error('Incomplete or unexpected package inputs');
  const generated = new Set();
  if (manifest.version === 2) {
    if (JSON.stringify(manifest.derivations) !== JSON.stringify(copilotDerivations())
      || manifest.derivationsHash !== identity(manifest.derivations)) throw new Error('Invalid generated lineage');
    for (const derivation of manifest.derivations) {
      if (!manifest.payload.some(entry => entry.path === derivation.path)
        || derivation.inputs.some(input => !manifest.inputs.some(entry => entry.path === input))) throw new Error('Missing generated lineage input or output');
      generated.add(derivation.path);
    }
  } else if (manifest.derivations !== undefined || manifest.derivationsHash !== undefined) throw new Error('Invalid legacy lineage');
  const runtimePayload = manifest.payload.filter(entry => entry.path.startsWith('build/'));
  if (!runtimePayload.length) throw new Error('Incomplete runtime');
  for (const entry of completePackage ? manifest.payload : runtimePayload) {
    if (hash(readBytes(root, entry.path)) !== entry.sha256) throw new Error(`Altered package file: ${entry.path}`);
  }
  const expected = new Set([...runtimePayload.map(entry => entry.path.slice(6)), 'provenance.json']);
  const directories = new Set();
  for (const relative of expected) {
    for (let directory = path.posix.dirname(relative); directory !== '.'; directory = path.posix.dirname(directory)) directories.add(directory);
  }
  function visit(relative = '') {
    for (const name of fs.readdirSync(safePath(root, relative ? `build/${relative}` : 'build'))) {
      const child = relative ? `${relative}/${name}` : name;
      const target = safePath(root, `build/${child}`);
      if (child === '.gitignore') {
        if (!readBytes(root, 'build/.gitignore').equals(Buffer.from('*\n'))) throw new Error('Invalid local runtime ignore');
      } else if (fs.lstatSync(target).isDirectory()) {
        if (manifest.version === 2 && !directories.has(child)) throw new Error(`Unexpected runtime directory: ${child}`);
        visit(child);
      }
      else if (!expected.delete(child)) throw new Error(`Unexpected runtime file: ${child}`);
    }
  }
  visit();
  if (expected.size) throw new Error('Incomplete runtime');
  for (const entry of manifest.payload) {
    if (generated.has(entry.path)) continue;
    const inputPath = entry.path.startsWith('build/') ? entry.path.slice(6) : entry.path;
    if (manifest.inputs.find(input => input.path === inputPath)?.sha256 !== entry.sha256) throw new Error('Input/payload identity mismatch');
  }
  return manifest;
}

export function validateVendor(root, version = 2) {
  const files = new Set((version === 1 ? legacyBootstrap : bootstrapFiles).filter(file => file.startsWith('install/vendor/')));
  const directories = new Set(['install/vendor']);
  for (const file of files) {
    for (let directory = path.posix.dirname(file); directory.startsWith('install/vendor/'); directory = path.posix.dirname(directory)) {
      directories.add(directory);
    }
  }
  function visit(relative) {
    const target = safePath(root, relative);
    if (!fs.lstatSync(target).isDirectory()) throw new Error(`Non-directory vendor path: ${relative}`);
    for (const name of fs.readdirSync(target)) {
      const child = `${relative}/${name}`;
      if (directories.has(child)) visit(child);
      else if (files.delete(child)) readBytes(root, child);
      else throw new Error(`Unexpected vendor path: ${child}`);
    }
  }
  visit('install/vendor');
  if (files.size) throw new Error('Incomplete vendor files');
}

export function validatePackage(root) {
  const { version } = JSON.parse(readBytes(root, 'build/provenance.json'));
  validateVendor(root, version);
  return validate(root, true);
}

export function validateActiveRuntime(root) {
  return validate(root, false);
}

function treeIdentity(root, relative) {
  if (!fs.existsSync(safePath(root, relative))) return null;
  const entries = [];
  function visit(directory) {
    entries.push({ path: directory });
    for (const name of fs.readdirSync(safePath(root, directory)).sort()) {
      const child = `${directory}/${name}`;
      if (fs.lstatSync(safePath(root, child)).isDirectory()) visit(child);
      else entries.push({ path: child, sha256: hash(readBytes(root, child)) });
    }
  }
  visit(relative);
  return identity(entries);
}

export function activateRuntime({ mount, candidate, settings, projection, fault = () => {} }) {
  const manifest = validatePackage(candidate || mount);
  for (const entry of manifest.payload.filter(entry => !entry.path.startsWith('build/'))) {
    if (hash(readBytes(mount, entry.path)) !== entry.sha256) throw new Error(`Mixed bootstrap/build bytes: ${entry.path}`);
  }
  const active = safePath(mount, 'build');
  const beforeTree = treeIdentity(mount, 'build');
  const afterTree = candidate ? treeIdentity(candidate, 'build') : beforeTree;
  const lock = safePath(mount, '.runtime-lock');
  fs.mkdirSync(lock);
  let backupRoot;
  let moved = false;
  let installed = false;
  let settingsAttempted = false;
  try {
    projection?.lock();
    projection?.recheck();
    settings?.recheck?.();
    backupRoot = fs.mkdtempSync(path.join(safePath(mount), '.runtime-backup-'));
    writeBytes(backupRoot, '.gitignore', '*\n');
    projection?.backup(backupRoot);
    if (settings && settings.before !== null) writeBytes(backupRoot, 'settings.json', settings.before);
    fault('before-activate');
    if (treeIdentity(mount, 'build') !== beforeTree) throw new Error('Concurrent runtime change');
    projection?.recheck();
    settings?.recheck?.();
    if (candidate && fs.existsSync(active)) {
      fs.renameSync(active, path.join(backupRoot, 'build'));
      moved = true;
    }
    if (candidate) {
      fault('activate');
      if (fs.existsSync(safePath(mount, 'build'))) throw new Error('Concurrent runtime target');
      fs.renameSync(safePath(candidate, 'build'), active);
      installed = true;
    }
    fault('after-activate');
    if (JSON.stringify(validatePackage(mount)) !== JSON.stringify(manifest)) throw new Error('Concurrent package change');
    projection?.write(fault);
    if (settings) {
      settingsAttempted = true;
      fault('settings-write');
      settings.write();
    }
    fault('after-settings');
    projection?.recheck();
    if (JSON.stringify(validatePackage(mount)) !== JSON.stringify(manifest)) throw new Error('Concurrent package change');
  } catch (error) {
    const failures = [];
    try {
      fault('restore');
      for (const restore of [
        () => { if (settingsAttempted) settings.restore(); },
        () => projection?.restore(fault),
        () => {
          if (installed) {
            if (treeIdentity(mount, 'build') !== afterTree) throw new Error('Concurrent runtime edit prevents restoration');
            removeTree(active);
          }
          if (moved) {
            if (fs.existsSync(safePath(mount, 'build'))) throw new Error('Concurrent runtime target prevents restoration');
            fs.renameSync(safePath(backupRoot, 'build'), active);
          }
        },
      ]) {
        try { restore(); } catch (failure) { failures.push(failure); }
      }
    } catch (failure) { failures.push(failure); }
    if (failures.length) throw new Error(`Activation failed; restoration failed. Recovery backup retained: ${backupRoot}`, { cause: new AggregateError([error, ...failures]) });
    if (backupRoot) removeTree(backupRoot);
    throw new Error(`Activation failed; previous runtime ${moved ? 'restored' : 'unchanged or absent'}`, { cause: error });
  } finally {
    try { projection?.release(); }
    finally { fs.rmdirSync(safePath(mount, '.runtime-lock')); }
  }
  removeTree(backupRoot);
}