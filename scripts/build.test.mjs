import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
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

function fileSet(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    return entry.isDirectory() ? fileSet(root, child) : [child];
  }).sort();
}

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

test('same HEAD dirty helper, template and rules inputs change identity while unrelated files stay out', async context => {
  const { root } = sourceFixture(context);
  const first = await stageBuild({ sourceRoot: root, stagingParent: root });
  const revision = git(['rev-parse', 'HEAD'], root);
  for (const relative of ['scripts/parse-input.mjs', 'templates/_template.prompt.md', '.github/skills/pr-review/rules.md']) {
    write(root, relative, Buffer.concat([Buffer.from('\uFEFF'), fs.readFileSync(path.join(root, relative)), Buffer.from('\r\n')]));
  }
  write(root, '.github/pr-review.local/config.json', '{"private":true}');
  write(root, '.github/copilot-instructions.md', 'private instructions');
  write(root, '.github/prompts/private.prompt.md', 'not declared');
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