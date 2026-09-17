import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import jsonc from './vendor/jsonc-parser/lib/umd/main.js';
import { stageBuild } from '../scripts/build.mjs';
import { initialize, prepareSettings, diagnostics } from './init.mjs';
import { validatePackage, validateActiveRuntime, activateRuntime, hash, identity } from './runtime.mjs';

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

test('optional local ignore permits ordinary init without changing package identity', async context => {
  const options = await fixture(context);
  const manifest = validatePackage(options.mount);
  const ignore = path.join(options.mount, 'build/.gitignore');
  assert.deepEqual(fs.readFileSync(ignore), Buffer.from('*\n'));
  assert.deepEqual(validateActiveRuntime(options.mount), manifest);
  fs.rmSync(ignore);
  assert.equal((await initialize(options)).ready, true);
  assert.deepEqual(validatePackage(options.mount), manifest);
  assert.deepEqual(validateActiveRuntime(options.mount), manifest);
  assert.equal(fs.existsSync(ignore), false);
});

for (const invalid of ['wrong bytes', 'directory', 'symlink', 'hardlink', 'unreadable', 'extra file', 'missing payload']) {
  test(`optional local ignore still rejects ${invalid} before init writes`, async context => {
    const options = await fixture(context);
    const ignore = path.join(options.mount, 'build/.gitignore');
    fs.rmSync(ignore);
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
    if (invalid === 'missing payload') fs.rmSync(path.join(options.mount, 'build/scripts/parse-input.mjs'));
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