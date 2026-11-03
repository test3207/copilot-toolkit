import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import jsonc from './vendor/jsonc-parser/lib/umd/main.js';
import { stageBuild } from '../scripts/build.mjs';
import { initialize, prepareSettings, diagnostics } from './init.mjs';
import { validatePackage, validateActiveRuntime, validateVendor, activateRuntime, hash, identity } from './runtime.mjs';
import { prepareCopilot, ledgerPath } from './copilot.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const diagnose = () => ({ tools: [], warnings: [] });

test('Copilot entry documentation distinguishes qualified commands from retained Local names', () => {
  const handbook = fs.readFileSync(path.join(sourceRoot, 'INSTALL.md'), 'utf8');
  const preparation = handbook.split(/### Explicit Copilot Preparation\r?\n/)[1]?.split(/\r?\n---/)[0];
  assert.ok(preparation, 'Explicit Copilot preparation section exists');
  const commands = [...preparation.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]);
  assert.deepEqual(commands, [
    '/copilot-toolkit:dep',
    '/copilot-toolkit:work',
    '/copilot-toolkit:pr-review',
    '/copilot-toolkit:onboard-repo',
    '/copilot-toolkit:tool-dev',
  ]);
  assert.match(preparation, /menu displays colons as spaces[\s\S]*`\/copilot-toolkit tool-dev`/);
  assert.match(preparation, /`\/copilot-toolkit:tool-dev review "tool-dev"`/);
  assert.match(preparation, /Bare commands[\s\S]*`\/tool-dev`[\s\S]*retained Local[\s\S]*old Local resource/);
  assert.match(preparation, /same Copilot harness[\s\S]*updates and rollback/);
});

test('rollback documentation hands off by target capability before editor verification', () => {
  const handbook = fs.readFileSync(path.join(sourceRoot, 'INSTALL.md'), 'utf8');
  const rollback = handbook.split(/### Rolling back to a previous tag\r?\n/)[1]?.split(/\r?\n---/)[0];
  assert.ok(rollback, 'Rollback section exists');
  const sourceCheckout = rollback.split(/\* \*\*Source checkout\*\*/)[1]?.split(/\r?\n\* /)[0];
  const builtPackage = rollback.split(/\* \*\*Built package\*\*/)[1]?.split(/\r?\n\* /)[0];
  assert.ok(sourceCheckout, 'Source rollback branch exists');
  assert.ok(builtPackage, 'Package rollback branch exists');
  assert.match(rollback, /\[Build and Init\]\(#build-and-init\)/);
  assert.match(sourceCheckout, /scripts\/build\.mjs[^\n]*install\/init\.mjs/);
  assert.match(sourceCheckout, /Local: run\s+`node \.copilot-toolkit\/install\/init\.mjs --build`/);
  assert.match(sourceCheckout, /Copilot \(supported v2 source only\): run\s+`node \.copilot-toolkit\/install\/init\.mjs --harness copilot --build`/);
  assert.match(builtPackage, /Local: run\s+`node \.copilot-toolkit\/install\/init\.mjs`/);
  assert.match(builtPackage, /Copilot \(complete v2 package only\): run\s+`node \.copilot-toolkit\/install\/init\.mjs --harness copilot`/);
  assert.match(rollback, /Historical source-only[\s\S]*target tag's own setup/);
  assert.match(rollback, /remove or disable[\s\S]*newer[\s\S]*build\/\.github\//);
  assert.match(rollback, /Preserve unrelated[\s\S]*false/);
  assert.match(rollback, /Before selecting a historical target without Copilot support[\s\S]*\[Copilot cleanup\]\(#explicit-copilot-preparation\)[\s\S]*current installer/);
  assert.ok(rollback.indexOf('[Copilot cleanup]') < rollback.indexOf('checkout vX.Y.Z-previous'));
  assert.match(rollback, /Local requires \*\*Ready\*\*/);
  assert.match(rollback, /Copilot reports \*\*Prepared\*\*[\s\S]*`pendingAction`[\s\S]*\(#explicit-copilot-preparation\)/);
  assert.match(rollback, /Reload VS Code[\s\S]*selected[\s\S]*runtime/);
  assert.ok(rollback.indexOf('checkout vX.Y.Z-previous') < rollback.indexOf('install/init.mjs --build'));
  assert.ok(rollback.indexOf('install/init.mjs --build') < rollback.indexOf('Reload VS Code'));
});

test('lifecycle documentation preserves explicit Copilot preparation and Local-only discovery', () => {
  const handbook = fs.readFileSync(path.join(sourceRoot, 'INSTALL.md'), 'utf8');
  const upgrade = handbook.split(/## Scenario 5: Upgrade to a newer release\r?\n/)[1]?.split(/\r?\n---/)[0];
  const uninstall = handbook.split(/## Scenario 6: Uninstall \/ rollback\r?\n/)[1]?.split(/### Rolling back to a previous tag/)[0];
  const troubleshooting = handbook.split(/## Troubleshooting\r?\n/)[1]?.split(/\r?\n---/)[0];
  assert.ok(upgrade, 'Upgrade section exists');
  assert.ok(uninstall, 'Uninstall section exists');
  assert.ok(troubleshooting, 'Troubleshooting section exists');
  assert.match(upgrade, /\| Local \(default\) \| Copilot \(supported v2 targets only\) \|/);
  assert.match(upgrade, /\| Source checkout[^\n]*\| `node \.copilot-toolkit\/install\/init\.mjs --build` \| `node \.copilot-toolkit\/install\/init\.mjs --harness copilot --build` \|/);
  assert.match(upgrade, /\| Complete built package \| `node \.copilot-toolkit\/install\/init\.mjs` \| `node \.copilot-toolkit\/install\/init\.mjs --harness copilot` \|/);
  assert.match(upgrade, /omitting `--harness`[\s\S]*selects Local[\s\S]*removes unchanged owned Copilot projections/);
  const verification = upgrade.split('**Verify (both modes)**')[1];
  assert.ok(verification, 'Upgrade verification exists');
  assert.match(verification, /\*\*Local\*\*: require \*\*Ready\*\*/);
  assert.match(verification, /\*\*Copilot\*\*: expect \*\*Prepared\*\*[\s\S]*`pendingAction`[\s\S]*\(#explicit-copilot-preparation\)/);
  assert.match(uninstall, /Before uninstalling the mount[\s\S]*\[Copilot cleanup\]\(#explicit-copilot-preparation\)[\s\S]*current installer/);
  assert.ok(uninstall.indexOf('[Copilot cleanup]') < uninstall.indexOf('git submodule deinit'));
  assert.ok(uninstall.indexOf('[Copilot cleanup]') < uninstall.indexOf('install/sync.mjs --uninstall'));
  const localRow = troubleshooting.split(/\r?\n/).find(line => line.startsWith('| **Local**:'));
  const copilotRow = troubleshooting.split(/\r?\n/).find(line => line.startsWith('| **Copilot**:'));
  assert.ok(localRow, 'Local troubleshooting row exists');
  assert.ok(copilotRow, 'Copilot troubleshooting row exists');
  assert.match(localRow, /\*\*Ready\*\*[^\n]*three discovery maps/);
  assert.match(copilotRow, /\*\*Prepared\*\*[^\n]*`pendingAction`[^\n]*\(#explicit-copilot-preparation\)/);
  for (const row of troubleshooting.split(/\r?\n/).filter(line => line.includes('three discovery maps'))) {
    assert.match(row, /^\| \*\*Local\*\*:/);
  }
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

function removeFixture(target) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) { fs.unlinkSync(target); return; }
  for (const name of fs.readdirSync(target)) removeFixture(path.join(target, name));
  fs.rmdirSync(target);
}

function copyFixture(source, target) {
  if (!fs.statSync(source).isDirectory()) { fs.copyFileSync(source, target); return; }
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(source)) copyFixture(path.join(source, name), path.join(target, name));
}

async function fixture(context) {
  const consumerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit init space \u6d4b\u8bd5 '));
  context.after(() => removeFixture(consumerRoot));
  const candidate = await stageBuild({ sourceRoot, stagingParent: consumerRoot });
  const mount = path.join(consumerRoot, '.copilot-toolkit');
  fs.renameSync(candidate.root, mount);
  return { consumerRoot, mount, diagnose };
}

test('Copilot plan is mutation-free and rejects unowned, case and YAML identity collisions', async context => {
  const options = await fixture(context);
  const plan = () => prepareCopilot({ consumerRoot: options.consumerRoot, packageRoot: options.mount });
  assert.equal((await plan()).changes.length, 11);
  assert.equal(fs.existsSync(path.join(options.consumerRoot, '.github')), false);
  const directory = path.join(options.consumerRoot, '.github/agents');
  fs.mkdirSync(directory, { recursive: true });
  const projected = fs.readFileSync(path.join(options.mount, 'build/copilot/agents/work-implementer.agent.md'));
  for (const [filename, bytes] of [
    ['work-implementer.agent.md', projected],
    ['WORK-IMPLEMENTER.agent.md', projected],
    ['other.agent.md', Buffer.from('---\nname: "work-implementer"\n---\nConsumer file')],
    ['other.agent.md', Buffer.from('---\nname: WORK-IMPLEMENTER\n---\nConsumer file')],
    ['other.agent.md', Buffer.from('---\nname: " work-implementer "\n---\nConsumer file')],
    ['other.agent.md', Buffer.from('---\nname: >\n  work-implementer\n---\nConsumer file')],
    ['other.agent.md', Buffer.from('---\nname: [work-implementer]\n---\nConsumer file')],
    ['other.agent.md', Buffer.from('---\nname: unique\nname: work-implementer\n---\nConsumer file')],
    ['other.agent.md', Buffer.from('---\nname: unique\n...\nname: work-implementer\n---\nConsumer file')],
  ]) {
    const target = path.join(directory, filename);
    fs.writeFileSync(target, bytes);
    await assert.rejects(plan());
    assert.deepEqual(fs.readFileSync(target), bytes);
    assert.equal(fs.existsSync(path.join(options.consumerRoot, ledgerPath)), false);
    fs.unlinkSync(target);
    assert.equal(fs.existsSync(target), false, filename);
  }
  const prepared = await plan();
  fs.writeFileSync(path.join(directory, 'late.agent.md'), '---\nname: late\n---\n');
  assert.throws(prepared.recheck, /Concurrent/);
  assert.equal(await prepareCopilot({ consumerRoot: options.consumerRoot, remove: true }), null);
});

test('Copilot plan validates owned hashes, ledger paths and linked targets before writes', async context => {
  const options = await fixture(context);
  const plan = () => prepareCopilot({ consumerRoot: options.consumerRoot, packageRoot: options.mount });
  const initial = await plan();
  for (const change of initial.changes) {
    const target = path.join(options.consumerRoot, change.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, change.after);
  }
  assert.deepEqual((await plan()).changes, []);
  assert.equal((await prepareCopilot({ consumerRoot: options.consumerRoot, remove: true })).changes.length, 11);
  const target = path.join(options.consumerRoot, '.github/agents/work-implementer.agent.md');
  const before = fs.readFileSync(target);
  fs.appendFileSync(target, '\nuser edit');
  await assert.rejects(plan(), /Edited owned/);
  await assert.rejects(prepareCopilot({ consumerRoot: options.consumerRoot, remove: true }), /Edited owned/);
  fs.unlinkSync(target);
  assert.equal(fs.existsSync(target), false);
  await assert.rejects(plan(), /Missing owned/);
  fs.writeFileSync(target, before);
  const ledger = path.join(options.consumerRoot, ledgerPath);
  const original = fs.readFileSync(ledger);
  for (const mutate of [draft => { draft.version = 2; }, draft => { draft.files[0].path = '../outside'; },
    draft => { draft.files.push(draft.files[0]); }, draft => { draft.packageIdentity = 'unknown'; },
    draft => { draft.packageIdentity = [draft.packageIdentity]; }, draft => { draft.files[0].installedHash = [draft.files[0].installedHash]; }]) {
    const draft = JSON.parse(original);
    mutate(draft);
    fs.writeFileSync(ledger, JSON.stringify(draft));
    await assert.rejects(plan(), /Invalid/);
  }
  fs.writeFileSync(ledger, original);
  fs.unlinkSync(target);
  const external = path.join(options.consumerRoot, 'external');
  fs.writeFileSync(external, before);
  fs.linkSync(external, target);
  await assert.rejects(plan(), /linked input/);
  fs.unlinkSync(target);
  fs.writeFileSync(target, before);
  const directory = path.join(options.consumerRoot, '.github/agents');
  fs.renameSync(directory, `${directory}-original`);
  fs.symlinkSync(`${directory}-original`, directory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(plan(), /Linked/);
});

test('Copilot prepare is idempotent, settings-neutral and Local removes only owned agents', async context => {
  const options = await fixture(context);
  fs.mkdirSync(path.join(options.consumerRoot, '.vscode'));
  const settings = path.join(options.consumerRoot, '.vscode/settings.json');
  const original = Buffer.from('\uFEFF{\n// keep\n"chat.agentFilesLocations": {"custom": false},\n"chat.pluginLocations": {"consumer": false}\n}\n');
  fs.writeFileSync(settings, original);
  const initialized = await initialize({ ...options, harness: 'copilot' });
  assert.equal(initialized.status, 'prepared');
  assert.equal(initialized.ready, false);
  assert.equal(initialized.activationVerified, false);
  assert.equal(initialized.registration, 'not-checked');
  assert.match(initialized.pendingAction, /User\/MACHINE-scope chat\.pluginLocations/);
  assert.equal(initialized.pluginLocation, fs.realpathSync.native(path.join(options.mount, 'build/copilot/plugin')));
  assert.deepEqual(fs.readFileSync(settings), original);
  const ledger = path.join(options.consumerRoot, ledgerPath);
  const before = fs.readFileSync(ledger);
  await initialize({ ...options, harness: 'copilot' });
  assert.deepEqual(fs.readFileSync(ledger), before);
  assert.deepEqual(fs.readFileSync(settings), original);
  const custom = path.join(options.consumerRoot, '.github/agents/custom.agent.md');
  fs.writeFileSync(custom, '---\nname: consumer\n---\nConsumer body\n');
  assert.equal((await initialize(options)).ready, true);
  assert.equal(fs.existsSync(ledger), false);
  assert.deepEqual(fs.readdirSync(path.dirname(custom)), ['custom.agent.md']);
  assert.equal(jsonc.parse(fs.readFileSync(settings, 'utf8').replace(/^\uFEFF/, ''))['chat.pluginLocations'].consumer, false);
});

test('Copilot prepare rolls back agents and ledger at every publication stage', async context => {
  const options = await fixture(context);
  for (const phase of ['before-activate', 'after-activate', 'agent-write', 'agent-written', 'ledger-write', 'ledger-written', 'after-settings']) {
    await assert.rejects(initialize({ ...options, harness: 'copilot', fault(stage) { if (stage === phase) throw new Error(phase); } }), /Activation failed/);
    assert.equal(fs.existsSync(path.join(options.consumerRoot, '.github')), false, phase);
    assert.equal(fs.existsSync(path.join(options.consumerRoot, '.vscode')), false);
    validatePackage(options.mount);
    assert.equal(fs.readdirSync(options.mount).some(name => /^\.(?:runtime-lock|runtime-backup)/.test(name)), false);
  }
});

function updatePackagedAgent(mount, name, suffix) {
  const manifest = validatePackage(mount);
  const input = `.github/agents/${name}.md`;
  for (const relative of [`build/${input}`, `build/copilot/agents/${name}.agent.md`]) {
    fs.appendFileSync(path.join(mount, relative), suffix);
    manifest.payload.find(entry => entry.path === relative).sha256 = hash(fs.readFileSync(path.join(mount, relative)));
  }
  manifest.inputs.find(entry => entry.path === input).sha256 = manifest.payload.find(entry => entry.path === `build/${input}`).sha256;
  manifest.inputsHash = identity(manifest.inputs);
  manifest.payloadHash = identity(manifest.payload);
  fs.writeFileSync(path.join(mount, 'build/provenance.json'), JSON.stringify(manifest));
  validatePackage(mount);
}

test('Copilot lifecycle updates hashes, deletes retired ownership and refuses edited removal', async context => {
  const options = await fixture(context);
  await initialize({ ...options, harness: 'copilot' });
  const ledger = path.join(options.consumerRoot, ledgerPath);
  const before = JSON.parse(fs.readFileSync(ledger));
  const retired = '.github/agents/retired.agent.md';
  const bytes = Buffer.from('---\nname: retired\n---\nRetired owned agent\n');
  fs.writeFileSync(path.join(options.consumerRoot, retired), bytes);
  before.files.push({ path: retired, name: 'retired', installedHash: hash(bytes) });
  fs.writeFileSync(ledger, JSON.stringify(before));
  updatePackagedAgent(options.mount, 'work-implementer', '\nNew package body\n');
  await initialize({ ...options, harness: 'copilot' });
  const after = JSON.parse(fs.readFileSync(ledger));
  assert.notEqual(after.packageIdentity, before.packageIdentity);
  assert.equal(fs.existsSync(path.join(options.consumerRoot, retired)), false);
  assert.equal(after.files.length, 10);
  for (const entry of after.files) assert.equal(hash(fs.readFileSync(path.join(options.consumerRoot, entry.path))), entry.installedHash);
  const target = path.join(options.consumerRoot, '.github/agents/work-implementer.agent.md');
  fs.appendFileSync(target, '\nConsumer edit\n');
  const edited = fs.readFileSync(target);
  await assert.rejects(initialize(options), /Edited owned/);
  await assert.rejects(initialize({ ...options, harness: 'copilot' }), /Edited owned/);
  assert.deepEqual(fs.readFileSync(target), edited);
  assert.deepEqual(JSON.parse(fs.readFileSync(ledger)), after);
  assert.equal(fs.existsSync(path.join(options.consumerRoot, '.vscode')), false);
});

test('Copilot concurrency rechecks the full plan and serializes publication', async context => {
  const options = await fixture(context);
  await initialize({ ...options, harness: 'copilot' });
  const ledger = path.join(options.consumerRoot, ledgerPath);
  const original = fs.readFileSync(ledger);
  const agent = path.join(options.consumerRoot, '.github/agents/pr-finding-validator.agent.md');
  const before = fs.readFileSync(agent);
  updatePackagedAgent(options.mount, 'pr-finding-validator', '\nUpdate\n');
  const late = path.join(options.consumerRoot, '.github/agents/late.agent.md');
  await assert.rejects(initialize({ ...options, harness: 'copilot', fault(phase) {
    if (phase === 'planned') fs.writeFileSync(late, '---\nname: pr-finding-validator\n---\n');
  } }), /Activation failed/);
  assert.deepEqual(fs.readFileSync(agent), before);
  assert.deepEqual(fs.readFileSync(ledger), original);
  fs.unlinkSync(late);
  await assert.rejects(initialize({ ...options, harness: 'copilot', fault(phase) {
    if (phase === 'agent-write') fs.appendFileSync(agent, '\nConcurrent edit\n');
  } }), /Activation failed/);
  assert.match(fs.readFileSync(agent, 'utf8'), /Concurrent edit/);
  assert.deepEqual(fs.readFileSync(ledger), original);
  fs.writeFileSync(agent, before);
  const lock = path.join(options.consumerRoot, '.github/.copilot-toolkit/copilot-agents.lock');
  fs.mkdirSync(lock);
  await assert.rejects(initialize({ ...options, harness: 'copilot' }), /Activation failed/);
  assert.equal(fs.existsSync(lock), true);
  assert.deepEqual(fs.readFileSync(agent), before);
  fs.rmdirSync(lock);
  const runtimeLock = path.join(options.mount, '.runtime-lock');
  fs.mkdirSync(runtimeLock);
  await assert.rejects(initialize({ ...options, harness: 'copilot' }), /EEXIST/);
  assert.equal(fs.existsSync(runtimeLock), true);
  fs.rmdirSync(runtimeLock);
  await initialize({ ...options, harness: 'copilot' });
});

test('Copilot concurrency preserves user edits during rollback and retains recovery backups', async context => {
  for (const concurrent of ['agent', 'ledger', 'restoration']) {
    const options = await fixture(context);
    await initialize({ ...options, harness: 'copilot' });
    const relative = '.github/agents/pr-finding-validator.agent.md';
    const agent = path.join(options.consumerRoot, relative);
    const beforeAgent = fs.readFileSync(agent);
    const ledger = path.join(options.consumerRoot, ledgerPath);
    const beforeLedger = fs.readFileSync(ledger);
    updatePackagedAgent(options.mount, 'pr-finding-validator', '\nPublished update\n');
    await assert.rejects(initialize({ ...options, harness: 'copilot', fault(phase) {
      if (concurrent === 'agent' && phase === 'agent-written') {
        fs.appendFileSync(agent, '\nConcurrent consumer edit\n');
        throw new Error('post-write failure');
      }
      if (phase === 'ledger-written') {
        if (concurrent === 'ledger') fs.appendFileSync(ledger, '\n ');
        throw new Error('post-ledger failure');
      }
      if (concurrent === 'restoration' && phase === 'projection-restore') throw new Error('restore failure');
    } }), /restoration failed.*Recovery backup retained/);
    const backup = fs.readdirSync(options.mount).find(name => name.startsWith('.runtime-backup-'));
    assert.ok(backup);
    assert.deepEqual(fs.readFileSync(path.join(options.mount, backup, 'consumer', relative)), beforeAgent);
    assert.deepEqual(fs.readFileSync(path.join(options.mount, backup, 'consumer', ledgerPath)), beforeLedger);
    if (concurrent === 'agent') assert.match(fs.readFileSync(agent, 'utf8'), /Concurrent consumer edit/);
    if (concurrent === 'ledger') assert.notDeepEqual(fs.readFileSync(ledger), beforeLedger);
    assert.equal(fs.existsSync(path.join(options.mount, '.runtime-lock')), false);
    assert.equal(fs.existsSync(path.join(options.consumerRoot, '.github/.copilot-toolkit/copilot-agents.lock')), false);
  }
});

test('Copilot packaged CLI is source-free, settings-neutral and says Prepared, never Ready', async context => {
  const options = await fixture(context);
  fs.mkdirSync(path.join(options.consumerRoot, '.vscode'));
  const settings = path.join(options.consumerRoot, '.vscode/settings.json');
  fs.writeFileSync(settings, 'not JSONC; Copilot must not call prepareSettings');
  const cli = path.join(options.mount, 'install/init.mjs');
  const run = args => spawnSync(process.execPath, [cli, ...args], {
    cwd: options.consumerRoot, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: '' },
  });
  for (const args of [['--harness'], ['--harness', 'invalid'], ['--harness', 'copilot', '--harness', 'local']]) assert.equal(run(args).status, 2);
  const result = run(['--harness', 'copilot']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Prepared\./);
  assert.doesNotMatch(result.stdout, /Ready\./);
  assert.match(result.stdout, /"ready": false/);
  assert.match(result.stdout, /"activationVerified": false/);
  assert.match(result.stdout, /"registration": "not-checked"/);
  assert.equal(fs.readFileSync(settings, 'utf8'), 'not JSONC; Copilot must not call prepareSettings');
  for (const absent of ['scripts', '.github', 'node_modules', '.git']) assert.equal(fs.existsSync(path.join(options.mount, absent)), false);
  validatePackage(options.mount);
});

test('Copilot YAML vendor is closed and hash-checked before fresh CLI imports', async context => {
  const options = await fixture(context);
  const marker = path.join(options.consumerRoot, 'yaml-marker');
  const parser = path.join(options.mount, 'install/vendor/js-yaml/dist/js-yaml.mjs');
  const original = fs.readFileSync(parser);
  const cli = () => spawnSync(process.execPath, [path.join(options.mount, 'install/init.mjs'), '--harness', 'copilot'], {
    cwd: options.consumerRoot, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: '' },
  });
  for (const relative of ['install/vendor/js-yaml.js', 'install/vendor/js-yaml/dist/package.json']) {
    fs.writeFileSync(path.join(options.mount, relative), '{}');
    const result = cli();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Unexpected vendor/);
    assert.equal(fs.existsSync(path.join(options.consumerRoot, '.github')), false);
    fs.unlinkSync(path.join(options.mount, relative));
  }
  fs.appendFileSync(parser, `\nimport fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'executed');\n`);
  const result = cli();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Altered package file/);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.existsSync(path.join(options.consumerRoot, '.github')), false);
  fs.writeFileSync(parser, original);
});

test('settings concurrent edits survive write rejection and post-write rollback', async context => {
  const options = await fixture(context);
  fs.mkdirSync(path.join(options.consumerRoot, '.vscode'));
  const target = path.join(options.consumerRoot, '.vscode/settings.json');
  fs.writeFileSync(target, '{}\n');
  const prepared = prepareSettings(options.consumerRoot, options.mount);
  fs.writeFileSync(target, '{"user": true}\n');
  assert.throws(prepared.write, /Concurrent settings/);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"user": true}\n');
  const settings = prepareSettings(options.consumerRoot, options.mount);
  assert.throws(() => activateRuntime({ mount: options.mount, settings, fault(phase) {
    if (phase === 'after-settings') {
      fs.writeFileSync(target, '{"user": "concurrent"}\n');
      throw new Error('post-write failure');
    }
  } }), /restoration failed.*Recovery backup retained/);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"user": "concurrent"}\n');
});

test('optional local ignore permits ordinary init without changing package identity', async context => {
  const options = await fixture(context);
  const manifest = validatePackage(options.mount);
  const ignore = path.join(options.mount, 'build/.gitignore');
  assert.deepEqual(fs.readFileSync(ignore), Buffer.from('*\n'));
  assert.deepEqual(validateActiveRuntime(options.mount), manifest);
  removeFixture(ignore);
  assert.equal((await initialize(options)).ready, true);
  assert.deepEqual(validatePackage(options.mount), manifest);
  assert.deepEqual(validateActiveRuntime(options.mount), manifest);
  assert.equal(fs.existsSync(ignore), false);
});

for (const invalid of ['wrong bytes', 'directory', 'symlink', 'hardlink', 'unreadable', 'extra file', 'missing payload']) {
  test(`optional local ignore still rejects ${invalid} before init writes`, async context => {
    const options = await fixture(context);
    const ignore = path.join(options.mount, 'build/.gitignore');
    removeFixture(ignore);
    if (invalid === 'wrong bytes') fs.writeFileSync(ignore, '*\r\n');
    if (invalid === 'directory') fs.mkdirSync(ignore);
    if (invalid === 'symlink') {
      const target = path.join(options.consumerRoot, 'ignore-target');
      fs.mkdirSync(target);
      fs.symlinkSync(target, ignore, process.platform === 'win32' ? 'junction' : 'dir');
    }
    if (invalid === 'hardlink') {
      const target = path.join(options.consumerRoot, 'ignore-target');
      fs.writeFileSync(target, '*\n');
      fs.linkSync(target, ignore);
    }
    if (invalid === 'unreadable') {
      fs.writeFileSync(ignore, '*\n');
      const read = fs.readFileSync;
      context.mock.method(fs, 'readFileSync', (target, ...args) => {
        if (target === ignore) throw new Error('Injected unreadable ignore');
        return read(target, ...args);
      });
    }
    if (invalid === 'extra file') fs.writeFileSync(path.join(options.mount, 'build/extra.txt'), 'extra');
    if (invalid === 'missing payload') removeFixture(path.join(options.mount, 'build/scripts/parse-input.mjs'));
    assert.throws(() => validatePackage(options.mount));
    assert.throws(() => validateActiveRuntime(options.mount));
    await assert.rejects(initialize(options));
    assert.equal(fs.existsSync(path.join(options.consumerRoot, '.vscode')), false);
  });
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

test('JSONC missing maps preserve compact property bytes', async context => {
  const options = await fixture(context);
  fs.mkdirSync(path.join(options.consumerRoot, '.vscode'));
  const settings = path.join(options.consumerRoot, '.vscode/settings.json');
  const maps = ['chat.agentSkillsLocations', 'chat.agentFilesLocations', 'chat.promptFilesLocations'];
  const directories = ['skills', 'agents', 'prompts'];
  for (const value of ['{ "compact": [1,  2], "enabled" : false }', '[1,  { "keep" : true }]', 'false']) {
    for (const count of [0, 1, 3]) {
      for (const multiline of [false, true]) {
        const property = `"unrelated" : ${value}`;
        const entries = maps.slice(0, count).map((key, index) =>
          `"${key}" : { ".copilot-toolkit/.github/${directories[index]}" : false, "custom" : false }`);
        entries.push(property);
        const original = multiline ? `\uFEFF{\r\n\t// keep\r\n\t${entries.join(',\r\n\t')},\r\n}\r\n` : `{${entries.join(',')}}`;
        fs.writeFileSync(settings, original);
        const prepared = prepareSettings(options.consumerRoot, options.mount);
        const output = prepared.after.toString();
        assert.ok(output.includes(property), output);
        const errors = [];
        const parsed = jsonc.parse(output.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true });
        assert.deepEqual(errors, []);
        for (const [index, key] of maps.entries()) {
          assert.equal(parsed[key][`.copilot-toolkit/build/.github/${directories[index]}`], index >= count);
          if (index < count) assert.ok(output.includes('"custom" : false'));
        }
        if (multiline) {
          assert.ok(output.startsWith('\uFEFF{\r\n\t// keep\r\n\t'));
          assert.doesNotMatch(output, /(?<!\r)\n/);
        }
        prepared.write();
        assert.deepEqual(prepareSettings(options.consumerRoot, options.mount).after, prepared.after);
      }
    }
  }
  fs.mkdirSync(path.join(options.mount, '.vscode'));
  const original = '{"chat.agentSkillsLocations" : { ".github/skills" : true, "custom" : [1,  2] }}';
  fs.writeFileSync(path.join(options.mount, '.vscode/settings.json'), original);
  const prepared = prepareSettings(options.mount, options.mount);
  assert.ok(prepared.after.toString().includes('".github/skills" : false, "custom" : [1,  2]'));
  assert.equal(jsonc.parse(prepared.after.toString())['chat.agentSkillsLocations']['build/.github/skills'], true);
  prepared.write();
  assert.deepEqual(prepareSettings(options.mount, options.mount).after, prepared.after);
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

test('JSONC preserves the adjacent consumer comment with and without legacy migration', async context => {
  const options = await fixture(context);
  fs.mkdirSync(path.join(options.consumerRoot, '.vscode'));
  const settings = path.join(options.consumerRoot, '.vscode/settings.json');
  for (const discovery of ['.copilot-toolkit/build/.github/skills', '.copilot-toolkit/.github/skills']) {
    const original = '{\r\n  "chat.agentSkillsLocations": {\r\n' +
      `    "${discovery}": false,\r\n` +
      '    // consumer discovery must survive\r\n    "custom": true,\r\n  },\r\n' +
      '  "chat.agentFilesLocations": {".copilot-toolkit/build/.github/agents": true},\r\n' +
      '  "chat.promptFilesLocations": {".copilot-toolkit/build/.github/prompts": true}\r\n}\r\n';
    fs.writeFileSync(settings, original);
    const prepared = prepareSettings(options.consumerRoot, options.mount);
    assert.equal(prepared.after.toString(), original.replace(discovery, '.copilot-toolkit/build/.github/skills'));
    prepared.write();
    assert.deepEqual(prepareSettings(options.consumerRoot, options.mount).after, prepared.after);
  }
});

test('JSONC duplicate migration preserves comment tokens and first, middle, last separators', async context => {
  const options = await fixture(context);
  fs.mkdirSync(path.join(options.consumerRoot, '.vscode'));
  const settings = path.join(options.consumerRoot, '.vscode/settings.json');
  function comments(text) {
    const scanner = jsonc.createScanner(text);
    const result = [];
    for (let token = scanner.scan(); token !== jsonc.SyntaxKind.EOF; token = scanner.scan()) {
      if ([jsonc.SyntaxKind.LineCommentTrivia, jsonc.SyntaxKind.BlockCommentTrivia].includes(token)) {
        result.push(text.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength()));
      }
    }
    return result;
  }
  for (const position of [0, 1, 2]) {
    for (const trailing of ['', ',']) {
      for (const enabled of [true, false]) {
        for (const existing of ['.copilot-toolkit/build/.github/skills', './.copilot-toolkit/.github/skills']) {
          const entries = [`    "${existing}": ${enabled}`, '    // custom leading\n    "custom": {"unchanged": true}'];
          entries.splice(position, 0, `    // legacy leading\n    ".copilot-toolkit/.github/skills" /* key */ : /* value */ ${enabled} /* tail */`);
          const original = '\uFEFF{\n  "chat.agentSkillsLocations": {\n' + entries.join(',\n') + trailing + '\n    // closing\n  },\n' +
            '  "chat.agentFilesLocations": {".copilot-toolkit/build/.github/agents": true},\n' +
            '  "chat.promptFilesLocations": {".copilot-toolkit/build/.github/prompts": true}\n}\n';
          const input = enabled ? original : original.replaceAll('\n', '\r\n');
          fs.writeFileSync(settings, input);
          const prepared = prepareSettings(options.consumerRoot, options.mount);
          const output = prepared.after.toString();
          const errors = [];
          const parsed = jsonc.parse(output.slice(1), errors, { allowTrailingComma: true });
          assert.deepEqual(errors, [], `position=${position}, trailing=${trailing}, existing=${existing}`);
          assert.deepEqual(parsed['chat.agentSkillsLocations'], {
            '.copilot-toolkit/build/.github/skills': enabled, custom: { unchanged: true },
          });
          assert.equal(output[0], '\uFEFF');
          assert.deepEqual(comments(output), comments(input));
          assert.ok(output.includes('"custom": {"unchanged": true}'));
          if (!enabled) assert.doesNotMatch(output, /(?<!\r)\n/);
          prepared.write();
          assert.deepEqual(prepareSettings(options.consumerRoot, options.mount).after, prepared.after);
        }
      }
    }
  }
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
  assert.equal((await initialize({ ...options, consumerRoot: options.mount })).ready, true);
  assert.deepEqual(prepareSettings(options.mount, options.mount).after, prepared.after);
});

test('a consumer directly inside the toolkit mount is rejected without any writes', async context => {
  const options = await fixture(context);
  const consumerRoot = path.join(options.mount, 'install');
  const before = fs.readdirSync(options.mount, { recursive: true }).sort();
  assert.throws(() => prepareSettings(consumerRoot, options.mount), /Toolkit mount must be inside the consumer root/);
  await assert.rejects(initialize({ ...options, consumerRoot }), /Toolkit mount must be inside the consumer root/);
  assert.equal(fs.existsSync(path.join(consumerRoot, '.vscode')), false);
  assert.deepEqual(fs.readdirSync(options.mount, { recursive: true }).sort(), before);
});

test('unsupported nested toolkit mount is rejected before ordinary init or build writes', async context => {
  const options = await fixture(context);
  fs.mkdirSync(path.join(options.consumerRoot, 'nested'));
  const mount = path.join(options.consumerRoot, 'nested/toolkit');
  fs.renameSync(options.mount, mount);
  fs.mkdirSync(path.join(options.consumerRoot, '.vscode'));
  fs.writeFileSync(path.join(options.consumerRoot, '.vscode/settings.json'), '{"unrelated": false}\n');
  const snapshot = () => fs.readdirSync(options.consumerRoot, { recursive: true }).sort().map(relative => {
    const target = path.join(options.consumerRoot, relative);
    return [relative, fs.statSync(target).isFile() ? hash(fs.readFileSync(target)) : null];
  });
  const legalMounts = /Toolkit mount must be the consumer root itself or its direct \.copilot-toolkit child/;
  for (const conventionalPresent of [false, true]) {
    if (conventionalPresent) {
      const candidate = await stageBuild({ sourceRoot, stagingParent: options.consumerRoot });
      fs.renameSync(candidate.root, options.mount);
      const helper = 'scripts/parse-input.mjs';
      const target = path.join(options.mount, 'build', helper);
      fs.appendFileSync(target, '\n');
      const manifest = candidate.manifest;
      manifest.inputs.find(entry => entry.path === helper).sha256 = hash(fs.readFileSync(target));
      manifest.payload.find(entry => entry.path === `build/${helper}`).sha256 = hash(fs.readFileSync(target));
      manifest.inputsHash = identity(manifest.inputs);
      manifest.payloadHash = identity(manifest.payload);
      fs.writeFileSync(path.join(options.mount, 'build/provenance.json'), JSON.stringify(manifest));
      assert.notEqual(validatePackage(options.mount).inputsHash, validatePackage(mount).inputsHash);
    }
    const before = snapshot();
    assert.throws(() => prepareSettings(options.consumerRoot, mount), legalMounts);
    for (const build of [false, true]) {
      const stages = [];
      await assert.rejects(initialize({ ...options, mount, build, fault: stage => stages.push(stage) }), legalMounts);
      assert.deepEqual(stages, []);
      const result = spawnSync(process.execPath, [path.join(mount, 'install/init.mjs'), ...(build ? ['--build'] : [])], {
        cwd: options.consumerRoot, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: '' },
      });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, legalMounts);
      assert.deepEqual(snapshot(), before);
    }
  }
});

for (const name of ['toolkit', '.copilot-toolkit-other', '.copilot-toolkit2', '.COPILOT-TOOLKIT']) {
  test(`init mount boundary for direct child ${name}`, async context => {
    const options = await fixture(context);
    const mount = path.join(options.consumerRoot, name);
    fs.renameSync(options.mount, mount);
    if (name === '.COPILOT-TOOLKIT' && process.platform === 'win32') {
      assert.equal((await initialize({ ...options, mount, consumerRoot: options.consumerRoot.toUpperCase() })).ready, true);
      return;
    }
    const before = fs.readdirSync(options.consumerRoot, { recursive: true }).sort();
    for (const build of [false, true]) {
      await assert.rejects(initialize({ ...options, mount, build }), /consumer root itself or its direct \.copilot-toolkit child/);
      assert.deepEqual(fs.readdirSync(options.consumerRoot, { recursive: true }).sort(), before);
    }
  });
}

test('conventional mount path normalization keeps consumer ownership and link guards', async context => {
  const options = await fixture(context);
  const mount = `${options.mount}${path.sep}..${path.sep}.copilot-toolkit`;
  assert.equal((await initialize({ ...options, mount })).ready, true);
  const settings = path.join(options.consumerRoot, '.vscode/settings.json');
  const before = fs.readFileSync(settings);
  const alias = path.join(options.consumerRoot, 'alias');
  fs.symlinkSync(options.mount, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(initialize({ ...options, mount: alias }), /Linked/);
  assert.deepEqual(fs.readFileSync(settings), before);
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

for (const shadow of ['install/vendor/jsonc-parser.js', 'install/vendor/jsonc-parser/lib/umd/impl/parser']) {
  test(`owned vendor rejects executable shadow ${shadow} before packaged CLI loads parser`, async context => {
    const options = await fixture(context);
    const marker = path.join(options.consumerRoot, 'parser-marker');
    const genuine = shadow.endsWith('.js') ? './jsonc-parser/lib/umd/main.js' : './parser.js';
    const before = validatePackage(options.mount);
    fs.writeFileSync(path.join(options.mount, shadow),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); module.exports = require('${genuine}');\n`);
    const result = spawnSync(process.execPath, [path.join(options.mount, 'install/init.mjs')], {
      cwd: options.consumerRoot, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: '' },
    });
    assert.equal(fs.existsSync(marker), false, result.stderr);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Unexpected vendor/);
    assert.equal(fs.existsSync(path.join(options.consumerRoot, '.vscode')), false);
    assert.throws(() => validatePackage(options.mount), /Unexpected vendor/);
    assert.deepEqual(validateActiveRuntime(options.mount), before);
    for (const entry of before.payload) assert.equal(hash(fs.readFileSync(path.join(options.mount, entry.path))), entry.sha256);
  });
}

test('owned vendor preload checks the actual prepareSettings module instead of its mount argument', async context => {
  const options = await fixture(context);
  const other = await fixture(context);
  const marker = path.join(options.consumerRoot, 'parser-marker');
  const shadow = path.join(options.mount, 'install/vendor/jsonc-parser/lib/umd/impl/parser');
  fs.writeFileSync(shadow, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); module.exports = require('./parser.js');\n`);
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval',
    `const { prepareSettings } = await import(${JSON.stringify(pathToFileURL(path.join(options.mount, 'install/init.mjs')).href)}); prepareSettings(${JSON.stringify(other.consumerRoot)}, ${JSON.stringify(other.mount)});`], {
    cwd: options.consumerRoot, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: '' },
  });
  assert.equal(fs.existsSync(marker), false, result.stderr);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Unexpected vendor/);
  assert.equal(fs.existsSync(path.join(other.consumerRoot, '.vscode')), false);
  assert.ok(prepareSettings(options.consumerRoot, options.mount).after.length > 0);
  await assert.rejects(initialize(options), /Unexpected vendor/);
});

test('owned vendor closes files, intermediate directories and links without whitelisting other source', async context => {
  const options = await fixture(context);
  const vendor = path.join(options.mount, 'install/vendor');
  const before = validatePackage(options.mount);
  fs.writeFileSync(path.join(options.mount, 'install/authoring.txt'), 'unrelated authoring bytes');
  assert.deepEqual(validatePackage(options.mount), before);
  const cases = [
    ['file', 'package.json'], ['file', 'jsonc-parser/lib/umd/package.json'],
    ['file', 'jsonc-parser/lib/umd/main'], ['directory', 'unused'],
    ['directory', 'jsonc-parser/lib/umd/impl/parser'],
    ['missing', 'jsonc-parser/lib/umd/main.js'], ['directory', 'jsonc-parser/lib/umd/main.js'],
    ['hardlink', 'jsonc-parser/lib/umd/impl/parser.js'],
    ...['', 'jsonc-parser', 'jsonc-parser/lib', 'jsonc-parser/lib/umd', 'jsonc-parser/lib/umd/impl']
      .flatMap(relative => [['link', relative], ['file', relative]]),
  ];
  for (const [index, [kind, relative]] of cases.entries()) {
    removeFixture(vendor);
    copyFixture(path.join(sourceRoot, 'install/vendor'), vendor);
    const target = path.join(vendor, relative);
    removeFixture(target);
    if (kind === 'file') fs.writeFileSync(target, '{}');
    if (kind === 'directory') fs.mkdirSync(target);
    if (kind === 'link' || kind === 'hardlink') {
      const outside = path.join(options.consumerRoot, `vendor-target-${index}`);
      if (kind === 'link') {
        fs.mkdirSync(outside);
        fs.symlinkSync(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
      } else {
        fs.writeFileSync(outside, fs.readFileSync(path.join(sourceRoot, 'install/vendor', relative)));
        fs.linkSync(outside, target);
      }
    }
    assert.throws(() => validateVendor(options.mount), `${kind}: ${relative}`);
    assert.throws(() => validatePackage(options.mount), `${kind}: ${relative}`);
    assert.deepEqual(validateActiveRuntime(options.mount), before);
    const result = spawnSync(process.execPath, [path.join(options.mount, 'install/init.mjs')], {
      cwd: options.consumerRoot, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: '' },
    });
    assert.equal(result.status, 1, `${kind}: ${relative}: ${result.stderr}`);
    assert.equal(fs.existsSync(path.join(options.consumerRoot, '.vscode')), false);
  }
  assert.equal(fs.readFileSync(path.join(options.mount, 'install/authoring.txt'), 'utf8'), 'unrelated authoring bytes');
});

test('owned vendor rejects native POSIX special file nodes before reading', {
  skip: process.platform === 'win32' ? 'Native POSIX FIFO creation unavailable on Windows' : false,
}, async context => {
  const options = await fixture(context);
  for (const relative of ['install/vendor/jsonc-parser/lib/umd/main.js', 'install/vendor/jsonc-parser/lib/umd/impl']) {
    const target = path.join(options.mount, relative);
    removeFixture(target);
    const result = spawnSync('mkfifo', [target], { timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(result.status, 0, result.stderr);
    assert.throws(() => validateVendor(options.mount), /Non-regular|Non-directory/);
    removeFixture(target);
    copyFixture(path.join(sourceRoot, relative), target);
  }
});

test('ordinary init still rejects modified declared vendor bytes before execution', async context => {
  const options = await fixture(context);
  const marker = path.join(options.consumerRoot, 'parser-marker');
  const before = validateActiveRuntime(options.mount);
  fs.appendFileSync(path.join(options.mount, 'install/vendor/jsonc-parser/lib/umd/main.js'),
    `\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\n`);
  validateVendor(options.mount);
  const result = spawnSync(process.execPath, [path.join(options.mount, 'install/init.mjs')], {
    cwd: options.consumerRoot, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: '' },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Altered package file/);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.existsSync(path.join(options.consumerRoot, '.vscode')), false);
  assert.deepEqual(validateActiveRuntime(options.mount), before);
});

test('missing vendored dependency fails explicitly before parser execution or discovery writes', async context => {
  const options = await fixture(context);
  removeFixture(path.join(options.mount, 'install/vendor/jsonc-parser/lib/umd/main.js'));
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

for (const rollback of [false, true]) {
  test(`POSIX settings mode stays private during ${rollback ? 'post-write rollback' : 'successful replacement'}`, {
    skip: process.platform === 'win32' ? 'POSIX permission modes unavailable on Windows' : false,
  }, async context => {
    const options = await fixture(context);
    fs.mkdirSync(path.join(options.consumerRoot, '.vscode'));
    const target = path.join(options.consumerRoot, '.vscode/settings.json');
    const original = Buffer.from('{"unrelated": true}\n');
    fs.writeFileSync(target, original, { mode: 0o600 });
    fs.chmodSync(target, 0o600);
    if ((fs.statSync(target).mode & 0o777) !== 0o600) {
      context.skip('Filesystem does not support POSIX permission modes');
      return;
    }
    const previousUmask = process.umask(0o022);
    try {
      const publishedModes = [];
      const rename = fs.renameSync;
      context.mock.method(fs, 'renameSync', (from, to) => {
        if (to === target) publishedModes.push(fs.statSync(from).mode & 0o777);
        return rename(from, to);
      });
      const prepared = prepareSettings(options.consumerRoot, options.mount);
      if (rollback) {
        const settings = { ...prepared, write() { prepared.write(); throw new Error('Failure after replacement'); } };
        assert.throws(() => activateRuntime({ mount: options.mount, settings }), /Activation failed/);
        assert.deepEqual(fs.readFileSync(target), original);
      } else {
        prepared.write();
        assert.deepEqual(fs.readFileSync(target), prepared.after);
      }
      assert.deepEqual(publishedModes, rollback ? [0o600, 0o600] : [0o600]);
      assert.equal(fs.statSync(target).mode & 0o777, 0o600);
    } finally {
      process.umask(previousUmask);
    }
  });
}

test('linked consumer rejection reports assessed previous runtime availability', async context => {
  const options = await fixture(context);
  const linked = path.join(options.consumerRoot, 'linked-consumer');
  fs.symlinkSync(options.consumerRoot, linked, process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(path.join(options.consumerRoot, '.vscode'));
  const settings = path.join(options.consumerRoot, '.vscode/settings.json');
  fs.writeFileSync(settings, '{"unchanged": true}\n');
  for (const state of ['valid', 'invalid', 'absent']) {
    const helper = path.join(options.mount, 'build/scripts/parse-input.mjs');
    if (state === 'invalid') fs.appendFileSync(helper, '\n');
    if (state === 'absent') removeFixture(path.join(options.mount, 'build'));
    const before = state === 'absent' ? null : fs.readFileSync(helper);
    const result = spawnSync(process.execPath, [path.join(options.mount, 'install/init.mjs'), '--consumer-root', linked], {
      cwd: options.consumerRoot, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: '' },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(`Previous runtime available: ${state === 'valid'}\\. .*Linked`));
    await assert.rejects(initialize({ ...options, consumerRoot: linked }), error => {
      assert.match(error.message, /Linked/);
      assert.equal(error.previousRuntimeAvailable, state === 'valid');
      return true;
    });
    assert.equal(fs.readFileSync(settings, 'utf8'), '{"unchanged": true}\n');
    if (before) assert.deepEqual(fs.readFileSync(helper), before);
    else assert.equal(fs.existsSync(path.join(options.mount, 'build')), false);
  }
});

test('linked mount stays unassessed without runtime probing and CLI reports unknown', async context => {
  const options = await fixture(context);
  const linked = path.join(options.consumerRoot, 'linked-mount');
  fs.symlinkSync(options.mount, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const result = spawnSync(process.execPath, ['--preserve-symlinks-main', path.join(linked, 'install/init.mjs'),
    '--consumer-root', options.consumerRoot], {
    cwd: options.consumerRoot, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: '' },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Previous runtime available: unknown\. .*Linked/);
  const reads = context.mock.method(fs, 'readFileSync', () => { throw new Error('Unsafe mount was read'); });
  const listings = context.mock.method(fs, 'readdirSync', () => { throw new Error('Unsafe mount was listed'); });
  await assert.rejects(initialize({ ...options, mount: linked }), error => {
    assert.match(error.message, /Linked/);
    assert.equal(error.previousRuntimeAvailable, undefined);
    return true;
  });
  assert.equal(reads.mock.callCount(), 0);
  assert.equal(listings.mock.callCount(), 0);
  reads.mock.restore();
  listings.mock.restore();
  validatePackage(options.mount);
  assert.equal(fs.existsSync(path.join(options.consumerRoot, '.vscode')), false);
});

test('settings hardlinks and ancestor links are refused before writes', async context => {
  const options = await fixture(context);
  const original = path.join(options.consumerRoot, 'untouched.json');
  fs.writeFileSync(original, '{}\n');
  fs.mkdirSync(path.join(options.consumerRoot, '.vscode'));
  fs.linkSync(original, path.join(options.consumerRoot, '.vscode/settings.json'));
  await assert.rejects(initialize(options), /linked input/);
  assert.equal(fs.readFileSync(original, 'utf8'), '{}\n');
  removeFixture(path.join(options.consumerRoot, '.vscode'));
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