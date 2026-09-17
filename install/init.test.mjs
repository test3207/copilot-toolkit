import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { stageBuild } from '../scripts/build.mjs';
import { initialize, prepareSettings, diagnostics } from './init.mjs';
import { validatePackage, activateRuntime } from './runtime.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const diagnose = () => ({ tools: [], warnings: [] });

test('rollback documentation hands off by target capability before editor verification', () => {
  const handbook = fs.readFileSync(path.join(sourceRoot, 'INSTALL.md'), 'utf8');
  const rollback = handbook.split(/### Rolling back to a previous tag\r?\n/)[1]?.split(/\r?\n---/)[0];
  assert.ok(rollback, 'Rollback section exists');
  assert.match(rollback, /\[Build and Init\]\(#build-and-init\)/);
  assert.match(rollback, /Source checkout[^\n]*scripts\/build\.mjs[^\n]*install\/init\.mjs/);
  assert.match(rollback, /node \.copilot-toolkit\/install\/init\.mjs --build/);
  assert.match(rollback, /Built package[^\n]*\n[^\n]*`node \.copilot-toolkit\/install\/init\.mjs`/);
  assert.match(rollback, /Historical source-only[\s\S]*target tag's own setup/);
  assert.match(rollback, /remove or disable[\s\S]*newer[\s\S]*build\/\.github\//);
  assert.match(rollback, /Preserve unrelated[\s\S]*false/);
  assert.match(rollback, /Reload VS Code[\s\S]*selected[\s\S]*runtime/);
  assert.ok(rollback.indexOf('checkout vX.Y.Z-previous') < rollback.indexOf('install/init.mjs --build'));
  assert.ok(rollback.indexOf('install/init.mjs --build') < rollback.indexOf('Reload VS Code'));
});

test('settings documentation uses shared init instead of additive discovery migration', () => {
  const snippet = fs.readFileSync(path.join(sourceRoot, 'install/settings-snippet.jsonc'), 'utf8');
  const readme = fs.readFileSync(path.join(sourceRoot, 'README.md'), 'utf8');
  assert.match(snippet, /Reference only/);
  assert.match(snippet, /shared init[\s\S]*INSTALL\.md#build-and-init/);
  assert.match(snippet, /unrelated[\s\S]*false/);
  assert.match(snippet, /old toolkit source[\s\S]*built entries/);
  assert.doesNotMatch(snippet, /Add these entries|Merge these keys|alongside your existing entries/);
  assert.doesNotMatch(readme, /copy-paste settings snippet/);
  assert.match(readme, /shared init[\s\S]*INSTALL\.md#build-and-init/);
  assert.match(readme, /\[.*install\/settings-snippet\.jsonc.*\]\(install\/settings-snippet\.jsonc\)/);
});

async function fixture(context) {
  const consumerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit init space \u6d4b\u8bd5 '));
  context.after(() => fs.rmSync(consumerRoot, { recursive: true, force: true }));
  const candidate = await stageBuild({ sourceRoot, stagingParent: consumerRoot });
  const mount = path.join(consumerRoot, '.copilot-toolkit');
  fs.renameSync(candidate.root, mount);
  return { consumerRoot, mount, diagnose };
}

test('minimal consumer initializes without source or npm and is byte-idempotent', async context => {
  const options = await fixture(context);
  const settings = path.join(options.consumerRoot, '.vscode/settings.json');
  const result = await initialize(options);
  assert.equal(result.ready, true);
  const before = fs.readFileSync(settings);
  assert.equal(JSON.parse(before)['chat.agentSkillsLocations']['.copilot-toolkit/build/.github/skills'], true);
  await initialize(options);
  assert.deepEqual(fs.readFileSync(settings), before);
  assert.equal(fs.existsSync(path.join(options.mount, 'scripts')), false);
  assert.equal(fs.existsSync(path.join(options.mount, 'node_modules')), false);
});

test('JSONC preserves BOM, CRLF, comments, unknown keys and disabled toolkit entries', async context => {
  const options = await fixture(context);
  fs.mkdirSync(path.join(options.consumerRoot, '.vscode'));
  const settings = path.join(options.consumerRoot, '.vscode/settings.json');
  fs.writeFileSync(settings, '\uFEFF{\r\n\t// keep this comment\r\n\t"other": {"secret": "not logged"},\r\n\t"chat.agentSkillsLocations": {".copilot-toolkit/.github/skills": false, "custom": true,},\r\n}\r\n');
  await initialize(options);
  const text = fs.readFileSync(settings, 'utf8');
  assert.ok(text.startsWith('\uFEFF'));
  assert.ok(text.includes('\r\n\t// keep this comment'));
  assert.ok(text.includes('"other": {"secret": "not logged"}'));
  assert.ok(text.includes('"custom": true'));
  assert.match(text, /"\.copilot-toolkit\/build\/\.github\/skills": false/);
  assert.doesNotMatch(text, /"\.copilot-toolkit\/\.github\/skills"/);
  await initialize(options);
  assert.equal(fs.readFileSync(settings, 'utf8'), text);
});

test('malformed or ambiguous settings do not change the active package', async context => {
  const options = await fixture(context);
  fs.mkdirSync(path.join(options.consumerRoot, '.vscode'));
  for (const text of ['{', '{"chat.agentSkillsLocations": []}', '{"chat.agentSkillsLocations": {}, "chat.agentSkillsLocations": {}}',
    '{"chat.agentSkillsLocations": {".copilot-toolkit/.github/skills": false, ".copilot-toolkit/build/.github/skills": true}}']) {
    fs.writeFileSync(path.join(options.consumerRoot, '.vscode/settings.json'), text);
    await assert.rejects(initialize(options));
    assert.equal(fs.readFileSync(path.join(options.consumerRoot, '.vscode/settings.json'), 'utf8'), text);
    validatePackage(options.mount);
  }
});

test('self-hosting disables source discovery without disabling the built runtime on repeat', async context => {
  const options = await fixture(context);
  const prepared = prepareSettings(options.mount, options.mount);
  prepared.write();
  const value = JSON.parse(prepared.after);
  assert.equal(value['chat.agentSkillsLocations']['.github/skills'], false);
  assert.equal(value['chat.agentSkillsLocations']['build/.github/skills'], true);
  assert.deepEqual(prepareSettings(options.mount, options.mount).after, prepared.after);
});

test('actual packaged CLI initializes from a different cwd without source, checkout or external dependencies', async context => {
  const options = await fixture(context);
  fs.mkdirSync(path.join(options.consumerRoot, 'unrelated cwd'));
  fs.mkdirSync(path.join(options.consumerRoot, '.github'));
  const instructions = path.join(options.consumerRoot, '.github/copilot-instructions.md');
  fs.writeFileSync(instructions, 'Consumer-owned instructions\r\n');
  const result = spawnSync(process.execPath, [path.join(options.mount, 'install/init.mjs'), '--consumer-root', options.consumerRoot], {
    cwd: path.join(options.consumerRoot, 'unrelated cwd'), timeout: 22000, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: '', GH_TOKEN: '', GITHUB_TOKEN: '' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Ready\./);
  assert.match(result.stdout, /unavailable on PATH/);
  assert.equal(fs.readFileSync(instructions, 'utf8'), 'Consumer-owned instructions\r\n');
  assert.equal(fs.existsSync(path.join(options.consumerRoot, 'unrelated cwd/.vscode')), false);
  const review = spawnSync(process.execPath, [path.join(options.mount, 'build/scripts/pr-review-config.mjs'), 'resolve'], {
    cwd: options.consumerRoot, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(review.status, 0, review.stderr);
  assert.equal(fs.existsSync(path.join(options.mount, 'build/.github/pr-review.local')), false);
  assert.equal(fs.existsSync(path.join(options.consumerRoot, '.github/pr-review.local/config.json')), true);
  validatePackage(options.mount);
});

test('package tampering and usage errors fail without wiring settings', async context => {
  const options = await fixture(context);
  const cli = path.join(options.mount, 'install/init.mjs');
  const run = args => spawnSync(process.execPath, [cli, ...args], {
    cwd: options.consumerRoot, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const args of [['--unknown'], ['--consumer-root'], ['--build', '--build']]) {
    assert.equal(run(args).status, 2);
  }
  fs.appendFileSync(path.join(options.mount, 'build/scripts/parse-input.mjs'), '\nchanged\n');
  const failed = run([]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /not ready.*Previous runtime available: false/);
  assert.equal(fs.existsSync(path.join(options.consumerRoot, '.vscode/settings.json')), false);
});

test('missing vendored dependency fails explicitly before parser execution or discovery writes', async context => {
  const options = await fixture(context);
  fs.rmSync(path.join(options.mount, 'install/vendor/jsonc-parser/lib/umd/main.js'));
  const result = spawnSync(process.execPath, [path.join(options.mount, 'install/init.mjs')], {
    cwd: options.consumerRoot, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Init failed; this attempt is not ready/);
  assert.equal(fs.existsSync(path.join(options.consumerRoot, '.vscode/settings.json')), false);
});

test('a settings failure after replacement restores original bytes and package', async context => {
  const options = await fixture(context);
  fs.mkdirSync(path.join(options.consumerRoot, '.vscode'));
  const target = path.join(options.consumerRoot, '.vscode/settings.json');
  const original = Buffer.from('{\n  // preserve\n  "unrelated": 1\n}\n');
  fs.writeFileSync(target, original);
  const prepared = prepareSettings(options.consumerRoot, options.mount);
  const settings = { ...prepared, write() { prepared.write(); throw new Error('Failure after replacement'); } };
  assert.throws(() => activateRuntime({ mount: options.mount, settings }), /Activation failed/);
  assert.deepEqual(fs.readFileSync(target), original);
  validatePackage(options.mount);
});

test('settings hardlinks and ancestor links are refused before writes', async context => {
  const options = await fixture(context);
  const original = path.join(options.consumerRoot, 'untouched.json');
  fs.writeFileSync(original, '{}\n');
  fs.mkdirSync(path.join(options.consumerRoot, '.vscode'));
  fs.linkSync(original, path.join(options.consumerRoot, '.vscode/settings.json'));
  await assert.rejects(initialize(options), /linked input/);
  assert.equal(fs.readFileSync(original, 'utf8'), '{}\n');
  fs.rmSync(path.join(options.consumerRoot, '.vscode'), { recursive: true });
  fs.mkdirSync(path.join(options.consumerRoot, 'outside'));
  try { fs.symlinkSync(path.join(options.consumerRoot, 'outside'), path.join(options.consumerRoot, '.vscode'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { context.skip('Platform disallows link creation'); return; } throw error; }
  await assert.rejects(initialize(options), /Linked/);
  assert.deepEqual(fs.readdirSync(path.join(options.consumerRoot, 'outside')), []);
});

test('diagnostics bound probes, never expose captured credentials, and remain warnings', async context => {
  const calls = [];
  const result = diagnostics({ probe(command, args, options) {
    calls.push({ command, args, options });
    return { status: 0, stdout: 'version 99.1.2 secret-do-not-log', stderr: 'secret-do-not-log' };
  } });
  assert.equal(result.budgetMs, 15000);
  assert.doesNotMatch(JSON.stringify(result), /secret-do-not-log/);
  assert.ok(calls.every(call => call.options.timeout <= 2500 && call.options.stdio[0] === 'ignore'));
  assert.ok(calls.every(call => !call.args.includes('login') && !call.args.includes('get-access-token')));
  const options = await fixture(context);
  const initialized = await initialize({ ...options, diagnose() { throw new Error('optional failure'); } });
  assert.equal(initialized.ready, true);
  assert.match(initialized.warnings[0], /diagnostics failed/);
});