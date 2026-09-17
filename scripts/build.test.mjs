import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { build, stageBuild, snapshotInputs } from './build.mjs';
import { validatePackage, activateRuntime } from '../install/runtime.mjs';
import { initialize } from '../install/init.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const expectedRuntime = `
.github/agents/_template.md
.github/agents/pr-finding-validator.md
.github/agents/pr-impact-analyzer.md
.github/agents/pr-logic-reviewer.md
.github/agents/pr-quality-checker.md
.github/agents/work-architect-explorer.md
.github/agents/work-closure-detail-validator.md
.github/agents/work-closure-direction-validator.md
.github/agents/work-impact-tracer.md
.github/agents/work-implementer.md
.github/agents/work-rca-tracer.md
.github/prompts/dep.prompt.md
.github/prompts/onboard-repo.prompt.md
.github/prompts/pr-review.prompt.md
.github/prompts/tool-dev.prompt.md
.github/prompts/work.prompt.md
.github/skills/coding-standards/SKILL.md
.github/skills/coding-standards/common.md
.github/skills/coding-standards/csharp.md
.github/skills/coding-standards/typescript.md
.github/skills/dep-audit/SKILL.md
.github/skills/distill-submodule-rules/SKILL.md
.github/skills/onboard-repo/SKILL.md
.github/skills/onboard-repo/providers/_index.md
.github/skills/onboard-repo/providers/ado.md
.github/skills/onboard-repo/providers/generic-git.md
.github/skills/onboard-repo/providers/github.md
.github/skills/pr-review/SKILL.md
.github/skills/pr-review/anti-patterns/async-types.md
.github/skills/pr-review/anti-patterns/control-flow.md
.github/skills/pr-review/anti-patterns/index.md
.github/skills/pr-review/anti-patterns/lang/typescript-react.md
.github/skills/pr-review/anti-patterns/semantic.md
.github/skills/pr-review/decision.md
.github/skills/pr-review/providers/_index.md
.github/skills/pr-review/providers/ado.md
.github/skills/pr-review/providers/github.md
.github/skills/pr-review/reference.md
.github/skills/pr-review/rules.md
.github/skills/pr-review/steps/analyze.md
.github/skills/pr-review/steps/finalize.md
.github/skills/pr-review/steps/prep.md
.github/skills/pr-review/tags.md
.github/skills/pr-review/workflow.md
.github/skills/tool-dev/SKILL.md
.github/skills/tool-dev/context-engineering.md
.github/skills/tool-dev/subagent-design.md
.github/skills/tool-dev/update-design-gate.md
.github/skills/work/SKILL.md
.github/skills/work/anti-patterns/design.md
.github/skills/work/bugfix.md
.github/skills/work/closure-validation.md
.github/skills/work/feature.md
.github/skills/work/providers/_index.md
.github/skills/work/providers/ado.md
.github/skills/work/providers/github.md
.github/skills/work/shared.md
LICENSE
scripts/add-submodule.mjs
scripts/ado-rest.mjs
scripts/derive-repo-context.mjs
scripts/github-rest.mjs
scripts/lint-recipes.mjs
scripts/parse-git-remote.mjs
scripts/parse-input.mjs
scripts/preflight.mjs
scripts/pr-review-assemble.mjs
scripts/pr-review-config.mjs
scripts/pr-review-worktree.mjs
scripts/run-safe.mjs
templates/_template.prompt.md
templates/copilot-instructions.template.md
templates/template-skill/SKILL.md
`.trim().split('\n').sort();
const expectedBootstrap = `
install/init.mjs
install/runtime.mjs
install/vendor/jsonc-parser/LICENSE.md
install/vendor/jsonc-parser/NOTICE.md
install/vendor/jsonc-parser/README.md
install/vendor/jsonc-parser/package.json
install/vendor/jsonc-parser/lib/umd/main.js
install/vendor/jsonc-parser/lib/umd/main.d.ts
install/vendor/jsonc-parser/lib/umd/impl/edit.js
install/vendor/jsonc-parser/lib/umd/impl/format.js
install/vendor/jsonc-parser/lib/umd/impl/parser.js
install/vendor/jsonc-parser/lib/umd/impl/scanner.js
install/vendor/jsonc-parser/lib/umd/impl/string-intern.js
`.trim().split('\n').sort();

function temporaryDirectory(context) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-build-'));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  return temporary;
}

function execute(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' } });
}

function git(args, cwd) {
  const result = execute(process.platform === 'win32' ? 'git.exe' : 'git', ['--no-pager', ...args], cwd);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function write(root, relative, bytes) {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), bytes);
}

function sourceFixture(context) {
  const consumerRoot = temporaryDirectory(context);
  const root = path.join(consumerRoot, '.copilot-toolkit');
  git(['clone', '--quiet', '--no-hardlinks', '--no-checkout', sourceRoot, root], consumerRoot);
  for (const [relative, bytes] of snapshotInputs(sourceRoot)) write(root, relative, bytes);
  return { root, consumerRoot };
}

function cleanSourceFixture(context, name) {
  const consumerRoot = temporaryDirectory(context);
  const root = path.join(consumerRoot, name);
  git(['init', '--quiet', root], consumerRoot);
  git(['config', '--local', 'core.autocrlf', 'false'], root);
  for (const [relative, bytes] of snapshotInputs(sourceRoot)) write(root, relative, bytes);
  write(root, 'unrelated.txt', `${name}\n`);
  git(['add', '--all'], root);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', `core.hooksPath=${path.join(consumerRoot, 'no-hooks')}`, 'commit', '--quiet', '-m', name], root);
  assert.equal(git(['status', '--porcelain', '--untracked-files=all'], root), '');
  return { root, consumerRoot };
}

async function withEnvironment(values, operation) {
  const before = process.env;
  const replaced = new Set(Object.keys(values).map(key => key.toUpperCase()));
  process.env = { ...Object.fromEntries(Object.entries(before).filter(([key]) => !replaced.has(key.toUpperCase()))), ...values };
  try { return await operation(); }
  finally { process.env = before; }
}

function fileSet(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    return entry.isDirectory() ? fileSet(root, child) : [child];
  }).sort();
}

test('source init --build rejects vendor shadows before fresh-process parser loading or staging', async context => {
  const { root, consumerRoot } = sourceFixture(context);
  const cli = path.join(root, 'install/init.mjs');
  const marker = path.join(consumerRoot, 'parser-marker');
  write(consumerRoot, '.vscode/settings.json', '{"unchanged" : [1,  2]}\n');
  for (const active of [false, true]) {
    if (active) await build({ sourceRoot: root });
    const before = active ? fs.readFileSync(path.join(root, 'build/provenance.json')) : null;
    for (const shadow of ['install/vendor/jsonc-parser.js', 'install/vendor/jsonc-parser/lib/umd/impl/parser']) {
      const genuine = shadow.endsWith('.js') ? './jsonc-parser/lib/umd/main.js' : './parser.js';
      write(root, shadow, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); module.exports = require('${genuine}');\n`);
      const inventory = fs.readdirSync(root).sort();
      const inputs = snapshotInputs(root);
      const result = execute(process.execPath, [cli, '--build', '--consumer-root', consumerRoot], consumerRoot);
      assert.equal(fs.existsSync(marker), false, result.stderr);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Unexpected vendor/);
      assert.match(result.stderr, new RegExp(`Previous runtime available: ${active}\\.`));
      assert.equal(fs.readFileSync(path.join(consumerRoot, '.vscode/settings.json'), 'utf8'), '{"unchanged" : [1,  2]}\n');
      assert.deepEqual(fs.readdirSync(root).sort(), inventory);
      assert.deepEqual(snapshotInputs(root), inputs);
      if (before) assert.deepEqual(fs.readFileSync(path.join(root, 'build/provenance.json')), before);
      else assert.equal(fs.existsSync(path.join(root, 'build')), false);
      fs.rmSync(path.join(root, shadow));
      if (active) validatePackage(root);
    }
  }
});

test('source init --build accepts clean and declared dirty vendor bytes with unchanged authoring files', async context => {
  const { root, consumerRoot } = cleanSourceFixture(context, '.copilot-toolkit');
  const revision = git(['rev-parse', 'HEAD'], root);
  const property = '"unrelated" : { "keep" : [1,  2] }';
  write(consumerRoot, '.vscode/settings.json', `{${property}}\n`);
  write(root, 'install/authoring/notes.txt', 'outside the owned vendor boundary\n');
  let settings;
  let previousIdentity;
  for (const dirty of [false, true]) {
    if (dirty) {
      fs.appendFileSync(path.join(root, 'install/vendor/jsonc-parser/README.md'), '\n');
      fs.appendFileSync(path.join(root, 'install/init.mjs'), '\n');
    }
    const inputs = snapshotInputs(root);
    const result = execute(process.execPath, [path.join(root, 'install/init.mjs'), '--build', '--consumer-root', consumerRoot], consumerRoot);
    assert.equal(result.status, 0, result.stderr);
    const manifest = validatePackage(root);
    assert.equal(manifest.dirty, dirty);
    assert.equal(manifest.sourceCommit, revision);
    assert.equal(git(['rev-parse', 'HEAD'], root), revision);
    assert.deepEqual(snapshotInputs(root), inputs);
    if (previousIdentity) assert.notEqual(manifest.inputsHash, previousIdentity);
    previousIdentity = manifest.inputsHash;
    const after = fs.readFileSync(path.join(consumerRoot, '.vscode/settings.json'));
    assert.ok(after.toString().includes(property));
    if (settings) assert.deepEqual(after, settings);
    settings = after;
    assert.equal(fs.readFileSync(path.join(root, 'install/authoring/notes.txt'), 'utf8'), 'outside the owned vendor boundary\n');
  }
});

test('minimal runtime rejects source fallback and executes without authoring files', async context => {
  const { stageBuild } = await import('./build.mjs');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-build-'));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const candidate = await stageBuild({ sourceRoot, stagingParent: temporary });
  for (const absent of ['.github', 'scripts', 'templates', '.git', 'node_modules']) {
    assert.equal(fs.existsSync(path.join(candidate.root, absent)), false, absent);
  }
  for (const name of ['work', 'pr-review', 'dep', 'tool-dev', 'onboard-repo']) {
    const prompt = fs.readFileSync(path.join(candidate.root, 'build/.github/prompts', `${name}.prompt.md`), 'utf8');
    assert.match(prompt, /\.copilot-toolkit\/build\/\.github/);
    assert.doesNotMatch(prompt, /Test-Path '\.copilot-toolkit\/\.github'|else \{ '\.github' \}/);
  }
  const result = spawnSync(process.execPath, [path.join(candidate.root, 'build/scripts/parse-input.mjs'), '45'], {
    cwd: temporary, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { type: 'unknown', id: '45' });
});

test('independent expected set and every raw byte match the complete isolated package', async context => {
  const temporary = temporaryDirectory(context);
  const candidate = await stageBuild({ sourceRoot, stagingParent: temporary });
  const expected = [...expectedRuntime.map(file => `build/${file}`), ...expectedBootstrap,
    '.gitignore', 'build/.gitignore', 'build/provenance.json'].sort();
  assert.deepEqual(fileSet(candidate.root), expected);
  assert.deepEqual(candidate.manifest.inputs.map(entry => entry.path),
    [...expectedRuntime, ...expectedBootstrap, 'scripts/build.mjs'].sort());
  for (const relative of [...expectedRuntime, ...expectedBootstrap]) {
    const bytes = fs.readFileSync(path.join(sourceRoot, relative));
    const output = expectedBootstrap.includes(relative) ? relative : `build/${relative}`;
    assert.deepEqual(fs.readFileSync(path.join(candidate.root, output)), bytes, relative);
    assert.equal(candidate.manifest.inputs.find(entry => entry.path === relative).sha256,
      createHash('sha256').update(bytes).digest('hex'));
    if (relative.endsWith('.md') && !relative.startsWith('install/')) {
      const text = bytes.toString('utf8');
      assert.doesNotMatch(text, /\.copilot-toolkit\/(?:\.github|scripts|templates)\//, relative);
      for (const match of text.matchAll(/\.copilot-toolkit\/build\/(scripts\/[a-z-]+\.mjs)/g)) {
        assert.ok(expectedRuntime.includes(match[1]), `${relative}: ${match[1]}`);
      }
    }
    if (relative.startsWith('scripts/')) {
      for (const match of bytes.toString('utf8').matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        assert.match(match[1], /^node:/, `Unexpected unshipped helper import: ${relative}`);
      }
    }
  }
  assert.equal(candidate.manifest.sourceCommit, git(['rev-parse', 'HEAD'], sourceRoot));
});

test('recipe gate instructions pair the built executable with explicit authoring inputs', () => {
  const skill = fs.readFileSync(path.join(sourceRoot, '.github/skills/tool-dev/SKILL.md'), 'utf8');
  assert.ok(skill.includes('node .copilot-toolkit/build/scripts/lint-recipes.mjs .copilot-toolkit/.github'));
  assert.ok(skill.includes('node build/scripts/lint-recipes.mjs .github'));
  assert.ok(skill.includes('node .copilot-toolkit/build/scripts/lint-recipes.mjs .github'));
  assert.match(skill, /actual repo.*being edited/);
  assert.match(skill, /do not rebuild/i);
});

test('built recipe gate detects source-only violations in mounted and self-hosted source', async context => {
  const { root, consumerRoot } = sourceFixture(context);
  await build({ sourceRoot: root });
  const runtime = path.join(root, 'build');
  const cached = new Map(fileSet(runtime).map(relative => [relative, fs.readFileSync(path.join(runtime, relative))]));
  const executable = path.join(runtime, 'scripts/lint-recipes.mjs');
  fs.appendFileSync(path.join(root, '.github/skills/tool-dev/SKILL.md'), '\n```pwsh\nWrite-Output first\nWrite-Output second\n```\n');
  for (const [cwd, subject] of [[consumerRoot, '.copilot-toolkit/.github'], [root, '.github']]) {
    const cachedOnly = execute(process.execPath, [executable], cwd);
    assert.equal(cachedOnly.status, 0, cachedOnly.stdout + cachedOnly.stderr);
    const actualSource = execute(process.execPath, [executable, subject], cwd);
    assert.equal(actualSource.status, 1, actualSource.stdout + actualSource.stderr);
    assert.match(actualSource.stdout, /tool-dev[/\\]SKILL\.md/);
    assert.match(actualSource.stdout, /multi-step inline shell \(2 statements\)/);
  }
  assert.deepEqual(fileSet(runtime), [...cached.keys()]);
  for (const [relative, bytes] of cached) assert.deepEqual(fs.readFileSync(path.join(runtime, relative)), bytes, relative);
  validatePackage(root);
});

test('minimal consumer gates its own source with the packaged recipe helper', async context => {
  const consumerRoot = temporaryDirectory(context);
  const candidate = await stageBuild({ sourceRoot, stagingParent: consumerRoot });
  const mount = path.join(consumerRoot, '.copilot-toolkit');
  fs.renameSync(candidate.root, mount);
  const before = validatePackage(mount);
  const executable = path.join(mount, 'build/scripts/lint-recipes.mjs');
  const recipe = '.github/prompts/consumer.prompt.md';
  write(consumerRoot, recipe, '# Consumer recipe\n\n```bash\nprintf first\nprintf second\n```\n');
  for (const absent of ['.github', 'scripts', '.git', 'node_modules']) assert.equal(fs.existsSync(path.join(mount, absent)), false);
  assert.equal(execute(process.execPath, [executable], consumerRoot).status, 0);
  for (const subject of ['.github', path.join(consumerRoot, recipe)]) {
    const result = execute(process.execPath, [executable, subject], consumerRoot);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /consumer\.prompt\.md/);
    assert.match(result.stdout, /multi-step inline shell \(2 statements\)/);
  }
  assert.deepEqual(validatePackage(mount), before);
});

test('clean provenance ignores unrelated-only edits and tracks declared dirty inputs at the same HEAD', async context => {
  const consumerRoot = temporaryDirectory(context);
  const root = path.join(consumerRoot, '.copilot-toolkit');
  git(['init', '--quiet', root], consumerRoot);
  git(['config', '--local', 'core.autocrlf', 'false'], root);
  for (const [relative, bytes] of snapshotInputs(sourceRoot)) write(root, relative, bytes);
  write(root, 'unrelated.txt', 'baseline\n');
  git(['add', '--all'], root);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', `core.hooksPath=${path.join(consumerRoot, 'no-hooks')}`, 'commit', '--quiet', '-m', 'Fixture baseline'], root);
  assert.equal(git(['status', '--porcelain', '--untracked-files=all'], root), '');
  const first = await stageBuild({ sourceRoot: root, stagingParent: root });
  const revision = git(['rev-parse', 'HEAD'], root);
  assert.equal(first.manifest.dirty, false);
  assert.equal(first.manifest.sourceCommit, revision);
  write(root, 'unrelated.txt', 'unrelated tracked change\n');
  write(root, '.github/pr-review.local/config.json', '{"private":true}');
  write(root, '.github/copilot-instructions.md', 'private instructions');
  write(root, '.github/prompts/private.prompt.md', 'not declared');
  const unrelated = await stageBuild({ sourceRoot: root, stagingParent: root });
  assert.equal(unrelated.manifest.dirty, false);
  assert.deepEqual(unrelated.manifest, first.manifest);
  assert.equal(git(['rev-parse', 'HEAD'], root), revision);
  for (const relative of ['scripts/parse-input.mjs', 'templates/_template.prompt.md', '.github/skills/pr-review/rules.md']) {
    write(root, relative, Buffer.concat([Buffer.from('\uFEFF'), fs.readFileSync(path.join(root, relative)), Buffer.from('\r\n')]));
  }
  const second = await stageBuild({ sourceRoot: root, stagingParent: root });
  assert.equal(second.manifest.sourceCommit, revision);
  assert.equal(second.manifest.dirty, true);
  assert.notEqual(second.manifest.inputsHash, first.manifest.inputsHash);
  assert.notEqual(second.manifest.payloadHash, first.manifest.payloadHash);
  assert.deepEqual(fileSet(second.root), fileSet(first.root));
  assert.deepEqual(fs.readFileSync(path.join(second.root, 'build/templates/_template.prompt.md')),
    fs.readFileSync(path.join(root, 'templates/_template.prompt.md')));
  const stable = await stageBuild({ sourceRoot: root, stagingParent: root });
  assert.deepEqual(stable.manifest, second.manifest);
  assert.equal(git(['rev-parse', 'HEAD'], root), revision);
});

test('builder Git selectors cannot substitute a foreign repository for the selected source', async context => {
  const own = cleanSourceFixture(context, 'selected-source');
  const foreign = cleanSourceFixture(context, 'foreign-source');
  assert.notEqual(git(['rev-parse', 'HEAD'], own.root), git(['rev-parse', 'HEAD'], foreign.root));
  const ownGit = path.join(own.root, '.git');
  const foreignGit = path.join(foreign.root, '.git');
  const selectors = [
    ['own directory', { GIT_DIR: ownGit }],
    ['foreign directory', { GIT_DIR: foreignGit }],
    ['foreign repository pair', { GIT_DIR: foreignGit, GIT_WORK_TREE: foreign.root }],
    ['foreign directory own tree', { GIT_DIR: foreignGit, GIT_WORK_TREE: own.root }],
    ['own directory foreign tree', { GIT_DIR: ownGit, GIT_WORK_TREE: foreign.root }],
    ['foreign work tree', { GIT_WORK_TREE: foreign.root }],
    ['foreign common directory', { GIT_COMMON_DIR: foreignGit }],
    ['foreign index', { GIT_INDEX_FILE: path.join(foreignGit, 'index') }],
    ['foreign objects', { GIT_OBJECT_DIRECTORY: path.join(foreignGit, 'objects') }],
    ['alternate objects', { GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(foreignGit, 'objects') }],
    ['combined repository selectors', { GIT_DIR: foreignGit, GIT_WORK_TREE: own.root, GIT_COMMON_DIR: foreignGit,
      GIT_INDEX_FILE: path.join(foreignGit, 'index'), GIT_OBJECT_DIRECTORY: path.join(foreignGit, 'objects') }],
  ];
  for (const dirty of [false, true]) {
    if (dirty) fs.appendFileSync(path.join(own.root, 'scripts/parse-input.mjs'), '\n');
    const expected = await stageBuild({ sourceRoot: own.root, stagingParent: own.consumerRoot });
    assert.equal(expected.manifest.dirty, dirty);
    for (const [name, values] of selectors) {
      await context.test(`${dirty ? 'dirty' : 'clean'} source with ${name}`, async () => {
        const actual = await withEnvironment(values, () => stageBuild({ sourceRoot: own.root, stagingParent: own.consumerRoot }));
        assert.deepEqual(actual.manifest, expected.manifest);
        for (const entry of expected.manifest.payload) {
          assert.deepEqual(fs.readFileSync(path.join(actual.root, entry.path)), fs.readFileSync(path.join(expected.root, entry.path)), entry.path);
        }
      });
    }
  }
  const copy = path.join(own.root, 'source-only');
  for (const [relative, bytes] of snapshotInputs(own.root)) write(copy, relative, bytes);
  const before = fs.readdirSync(own.consumerRoot).sort();
  for (const values of [{}, { GIT_DIR: foreignGit }, { GIT_DIR: foreignGit, GIT_WORK_TREE: copy }]) {
    await withEnvironment(values, () => assert.rejects(stageBuild({ sourceRoot: copy, stagingParent: own.consumerRoot }),
      /Build requires the toolkit source checkout/));
    assert.deepEqual(fs.readdirSync(own.consumerRoot).sort(), before);
  }
});

test('builder filters all 18 Git selectors case-insensitively and retains harmless configuration and auth fields', async context => {
  const own = cleanSourceFixture(context, 'environment-source');
  const selected = [
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_QUARANTINE_PATH', 'GIT_NAMESPACE',
    'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
    'GIT_INTERNAL_SUPER_PREFIX', 'GIT_IMPLICIT_WORK_TREE', 'GIT_CEILING_DIRECTORIES',
    'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_TEMPLATE_DIR', 'GIT_CONFIG',
  ];
  const retained = {
    GIT_CONFIG_GLOBAL: 'fixture-global', GIT_CONFIG_SYSTEM: 'fixture-system', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_PARAMETERS: "'core.autocrlf=false'", GIT_SSH: 'fixture-ssh', GIT_SSH_COMMAND: 'fixture-ssh-command',
    GIT_ASKPASS: 'fixture-askpass', SSH_AUTH_SOCK: 'fixture-agent', GH_TOKEN: 'fixture-token',
    HTTPS_PROXY: 'http://proxy.example.invalid', HTTP_PROXY: 'http://proxy.example.invalid',
    GIT_SSL_CAINFO: 'fixture-ca', GIT_SSL_CAPATH: 'fixture-ca-path',
  };
  const normalEnvironment = process.env;
  const originalSpawn = childProcess.spawnSync;
  let calls = 0;
  context.mock.method(childProcess, 'spawnSync', (command, args, options) => {
    calls++;
    const keys = Object.keys(options.env).map(key => key.toUpperCase());
    for (const key of selected) assert.equal(keys.includes(key), false, key);
    for (const [key, value] of Object.entries(retained)) assert.ok(options.env[key] === value, `Retain ${key}`);
    assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(options.env.GIT_OPTIONAL_LOCKS, '0');
    return originalSpawn(command, args, { ...options, env: normalEnvironment });
  });
  syncBuiltinESMExports();
  try {
    for (const casing of [key => key, key => key.toLowerCase(), key => `Git_${key.slice(4).toLowerCase()}`]) {
      await withEnvironment({ ...retained, ...Object.fromEntries(selected.map(key => [casing(key), 'fixture-selector'])) },
        () => stageBuild({ sourceRoot: own.root, stagingParent: own.consumerRoot }));
    }
    assert.equal(calls, 9);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('builder retains linked-worktree and submodule gitfile support at arbitrary source names', async context => {
  const own = cleanSourceFixture(context, 'arbitrary-source-name');
  const expected = await stageBuild({ sourceRoot: own.root, stagingParent: own.consumerRoot });
  const linked = path.join(own.consumerRoot, 'linked-source');
  git(['-c', 'core.autocrlf=false', 'worktree', 'add', '--quiet', '--detach', linked, 'HEAD'], own.root);
  assert.equal(fs.statSync(path.join(linked, '.git')).isFile(), true);
  const linkedBuild = await stageBuild({ sourceRoot: linked, stagingParent: own.consumerRoot });
  assert.deepEqual(linkedBuild.manifest, expected.manifest);
  const parent = path.join(own.consumerRoot, 'parent');
  git(['init', '--quiet', parent], own.consumerRoot);
  git(['-c', 'protocol.file.allow=always', '-c', 'core.autocrlf=false', 'submodule', 'add', '--quiet', own.root, 'mounted-source'], parent);
  const submodule = path.join(parent, 'mounted-source');
  git(['config', '--local', 'core.autocrlf', 'false'], submodule);
  assert.equal(fs.statSync(path.join(submodule, '.git')).isFile(), true);
  const submoduleBuild = await stageBuild({ sourceRoot: submodule, stagingParent: own.consumerRoot });
  assert.deepEqual(submoduleBuild.manifest, expected.manifest);
});

test('failed B after dirty helper and rules preserves executable independent runtime A and settings', async context => {
  const { root, consumerRoot } = sourceFixture(context);
  const options = { mount: root, consumerRoot, build: true, diagnose: () => ({}) };
  await initialize(options);
  const original = validatePackage(root);
  const settings = fs.readFileSync(path.join(consumerRoot, '.vscode/settings.json'));
  write(root, 'scripts/parse-input.mjs', 'throw new Error("Dirty source must not execute");\n');
  write(root, '.github/skills/pr-review/rules.md', 'Dirty B rules\n');
  for (const phase of ['staged', 'before-activate', 'activate', 'settings-write']) {
    await assert.rejects(initialize({ ...options, fault(name) { if (name === phase) throw new Error(`Injected ${phase}`); } }));
    assert.deepEqual(validatePackage(root), original);
    assert.deepEqual(fs.readFileSync(path.join(consumerRoot, '.vscode/settings.json')), settings);
    const result = execute(process.execPath, [path.join(root, 'build/scripts/parse-input.mjs'), '45'], consumerRoot);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { type: 'unknown', id: '45' });
    assert.deepEqual(fs.readFileSync(path.join(root, 'build/.github/skills/pr-review/rules.md')),
      fs.readFileSync(path.join(sourceRoot, '.github/skills/pr-review/rules.md')));
    assert.equal(fs.readdirSync(root).some(name => /^\.(?:toolkit-stage|runtime-backup)-/.test(name)), false);
  }
});

test('failed B after bootstrap edits reports restored executable runtime A', async context => {
  const { root, consumerRoot } = sourceFixture(context);
  const options = { mount: root, consumerRoot, build: true, diagnose: () => ({}) };
  await initialize(options);
  const original = fs.readFileSync(path.join(root, 'build/provenance.json'));
  const settings = fs.readFileSync(path.join(consumerRoot, '.vscode/settings.json'));
  const bootstrap = Buffer.concat([fs.readFileSync(path.join(root, 'install/init.mjs')), Buffer.from('\n')]);
  write(root, 'install/init.mjs', bootstrap);
  write(root, 'scripts/parse-input.mjs', 'throw new Error("Dirty source must not execute");\n');
  assert.throws(() => validatePackage(root), /Altered package file: install\/init\.mjs/);
  for (const phase of ['staged', 'before-activate', 'activate', 'settings-write']) {
    let failure;
    let reached = false;
    await assert.rejects(initialize({ ...options, fault(name) {
      if (name === phase) { reached = true; throw new Error(`Injected ${phase}`); }
    } }), error => { failure = error; return true; });
    assert.equal(reached, true);
    assert.deepEqual(fs.readFileSync(path.join(root, 'build/provenance.json')), original);
    assert.deepEqual(fs.readFileSync(path.join(consumerRoot, '.vscode/settings.json')), settings);
    assert.deepEqual(fs.readFileSync(path.join(root, 'install/init.mjs')), bootstrap);
    const result = execute(process.execPath, [path.join(root, 'build/scripts/parse-input.mjs'), '45'], consumerRoot);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { type: 'unknown', id: '45' });
    assert.equal(failure.previousRuntimeAvailable, true);
  }
  write(root, 'build/scripts/parse-input.mjs', 'throw new Error("Damaged runtime A");\n');
  await assert.rejects(initialize({ ...options, fault(phase) {
    if (phase === 'settings-write') throw new Error('Injected settings-write');
  } }), error => error.previousRuntimeAvailable === false);
});

test('build and init CLI failure status separates edited bootstrap from damaged runtime A', async context => {
  const { root, consumerRoot } = sourceFixture(context);
  await initialize({ mount: root, consumerRoot, build: true, diagnose: () => ({}) });
  const settings = fs.readFileSync(path.join(consumerRoot, '.vscode/settings.json'));
  fs.appendFileSync(path.join(root, 'install/init.mjs'), '\n');
  const bootstrap = fs.readFileSync(path.join(root, 'install/init.mjs'));
  fs.rmSync(path.join(root, 'scripts/parse-input.mjs'));
  for (const available of [true, false]) {
    if (!available) fs.rmSync(path.join(root, 'build/scripts/parse-input.mjs'));
    const built = execute(process.execPath, [path.join(root, 'scripts/build.mjs')], consumerRoot);
    assert.equal(built.status, 1, built.stderr);
    assert.ok(built.stderr.includes(`Valid runtime available: ${available}`), built.stderr);
    for (const args of [[], ['--build']]) {
      const initialized = execute(process.execPath, [path.join(root, 'install/init.mjs'), ...args], consumerRoot);
      assert.equal(initialized.status, 1, initialized.stderr);
      assert.ok(initialized.stderr.includes(`Previous runtime available: ${available}`), initialized.stderr);
    }
    assert.deepEqual(fs.readFileSync(path.join(root, 'install/init.mjs')), bootstrap);
    assert.deepEqual(fs.readFileSync(path.join(consumerRoot, '.vscode/settings.json')), settings);
  }
});

test('CLI availability uses recorded A payload when source declares different runtime B files', async context => {
  const { root, consumerRoot } = sourceFixture(context);
  await initialize({ mount: root, consumerRoot, build: true, diagnose: () => ({}) });
  const original = fs.readFileSync(path.join(root, 'build/provenance.json'));
  const declaration = fs.readFileSync(path.join(root, 'install/runtime.mjs'), 'utf8');
  const changed = declaration.replace("'templates/_template.prompt.md'", "'templates/round2-added.md'");
  assert.notEqual(changed, declaration);
  write(root, 'install/runtime.mjs', changed);
  const initialized = execute(process.execPath, [path.join(root, 'install/init.mjs')], consumerRoot);
  assert.equal(initialized.status, 1, initialized.stderr);
  assert.match(initialized.stderr, /Previous runtime available: true/);
  assert.match(initialized.stderr, /Incomplete or unexpected package payload/);
  const built = execute(process.execPath, [path.join(root, 'scripts/build.mjs')], consumerRoot);
  assert.equal(built.status, 1, built.stderr);
  assert.match(built.stderr, /Valid runtime available: true/);
  assert.deepEqual(fs.readFileSync(path.join(root, 'build/provenance.json')), original);
  const result = execute(process.execPath, [path.join(root, 'build/scripts/parse-input.mjs'), '45'], consumerRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { type: 'unknown', id: '45' });
});

test('first build failure never wires discovery and restoration failure retains a recoverable backup', async context => {
  const { root, consumerRoot } = sourceFixture(context);
  const options = { mount: root, consumerRoot, build: true, diagnose: () => ({}) };
  await assert.rejects(initialize({ ...options, fault(name) { if (name === 'settings-write') throw new Error('write'); } }));
  assert.equal(fs.existsSync(path.join(root, 'build')), false);
  assert.equal(fs.existsSync(path.join(consumerRoot, '.vscode/settings.json')), false);
  await initialize(options);
  const original = fs.readFileSync(path.join(root, 'build/provenance.json'));
  await assert.rejects(initialize({ ...options, fault(name) {
    if (name === 'settings-write' || name === 'restore') throw new Error(name);
  } }), /restoration failed.*Recovery backup retained/);
  const backup = fs.readdirSync(root).find(name => name.startsWith('.runtime-backup-'));
  assert.ok(backup);
  assert.deepEqual(fs.readFileSync(path.join(root, backup, 'build/provenance.json')), original);
  assert.ok(fs.existsSync(path.join(root, backup, 'settings.json')));
  assert.equal(fs.readFileSync(path.join(root, backup, '.gitignore'), 'utf8'), '*\n');
});

test('missing source, tampered candidate and extra runtime files fail closed', async context => {
  const { root } = sourceFixture(context);
  const first = await stageBuild({ sourceRoot: root, stagingParent: root });
  activateRuntime({ mount: root, candidate: first.root });
  const original = validatePackage(root);
  fs.rmSync(path.join(root, 'scripts/parse-input.mjs'));
  await assert.rejects(build({ sourceRoot: root }));
  assert.deepEqual(validatePackage(root), original);
  write(root, 'scripts/parse-input.mjs', fs.readFileSync(path.join(sourceRoot, 'scripts/parse-input.mjs')));
  await assert.rejects(build({ sourceRoot: root, fault(phase, staged) {
    if (phase === 'staged') write(staged, 'build/scripts/parse-input.mjs', 'tampered');
  } }), /Altered package/);
  write(root, 'build/scripts/unexpected.mjs', 'extra');
  assert.throws(() => validatePackage(root), /Unexpected runtime file/);
});

test('linked inputs and targets, hardlinks and escaped manifest paths are rejected', async context => {
  const { root, consumerRoot } = sourceFixture(context);
  const candidate = await stageBuild({ sourceRoot: root, stagingParent: root });
  const helper = path.join(root, 'scripts/parse-input.mjs');
  fs.rmSync(helper);
  fs.linkSync(path.join(root, 'scripts/preflight.mjs'), helper);
  await assert.rejects(stageBuild({ sourceRoot: root, stagingParent: root }), /linked input/);
  const manifest = JSON.parse(fs.readFileSync(path.join(candidate.root, 'build/provenance.json')));
  manifest.inputs[0].path = '../escape';
  write(candidate.root, 'build/provenance.json', JSON.stringify(manifest));
  assert.throws(() => validatePackage(candidate.root), /Unsafe package path/);
  fs.mkdirSync(path.join(consumerRoot, 'outside'));
  try { fs.symlinkSync(path.join(consumerRoot, 'outside'), path.join(root, 'build'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { context.skip('Platform disallows link creation'); return; } throw error; }
  await assert.rejects(initialize({ mount: root, consumerRoot, diagnose: () => ({}) }), /Linked/);
  assert.deepEqual(fs.readdirSync(path.join(consumerRoot, 'outside')), []);
});

test('explicit builder CLI and init CLI preserve source revision and source-disabled self-host discovery', async context => {
  const { root, consumerRoot } = sourceFixture(context);
  const revision = git(['rev-parse', 'HEAD'], root);
  const built = execute(process.execPath, [path.join(root, 'scripts/build.mjs')], consumerRoot);
  assert.equal(built.status, 0, built.stderr);
  assert.match(built.stdout, /discovery unchanged/);
  const initialized = execute(process.execPath, [path.join(root, 'install/init.mjs'), '--consumer-root', root], consumerRoot);
  assert.equal(initialized.status, 0, initialized.stderr);
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.vscode/settings.json')));
  assert.equal(settings['chat.promptFilesLocations']['.github/prompts'], false);
  assert.equal(settings['chat.promptFilesLocations']['build/.github/prompts'], true);
  assert.equal(git(['rev-parse', 'HEAD'], root), revision);
  validatePackage(root);
});