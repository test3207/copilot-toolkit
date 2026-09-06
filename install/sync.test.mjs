import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import vm from 'node:vm';
import { after, before, test } from 'node:test';

let temporary;
let upstream;
let bootstrap;
let faultModule;
let env;
let firstCommit;
let consumerNumber = 0;
const installer = fileURLToPath(new URL('./sync.mjs', import.meta.url));

function execute(command, args, cwd, extra = {}) {
  const result = spawnSync(command, args, {
    cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000, windowsHide: true, ...extra,
  });
  assert.ifError(result.error);
  return result;
}

function git(args, cwd = upstream, extra = {}) {
  const result = execute(process.platform === 'win32' ? 'git.exe' : 'git', [
    '--no-pager', '-c', `core.hooksPath=${path.join(temporary, 'no-hooks')}`,
    '-c', 'init.templateDir=', '-c', 'core.autocrlf=false', ...args,
  ], cwd, extra);
  assert.equal(result.status, 0, result.stderr);
  return Buffer.isBuffer(result.stdout) ? result.stdout : result.stdout.trim();
}

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function snapshot(root) {
  const result = {};
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) result[relative] = `link:${fs.readlinkSync(full)}`;
      else if (entry.isDirectory()) visit(full, relative);
      else result[relative] = fs.readFileSync(full).toString('hex');
    }
  }
  visit(root);
  return result;
}

function consumer(context) {
  const root = path.join(temporary, `consumer space \u6d4b\u8bd5 ${++consumerNumber}`);
  fs.mkdirSync(root);
  const mount = path.join(root, '.copilot-toolkit');
  write(root, '.vscode/settings.json', '{"unchanged":true}\n');
  write(root, '.github/copilot-instructions.md', 'consumer instructions\n');
  write(root, '.github/registry.json', '{"consumer":"untouched"}\n');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, mount };
}

function invoke(root, args, fault, extraEnv = {}) {
  return execute(process.execPath, [
    ...(fault ? ['--require', faultModule] : []), bootstrap, ...args,
  ], root, { env: { ...env, ...extraEnv, SYNC_TEST_FAULT: fault || '' } });
}

function sync(root, tag = 'v1.0.0', extra = [], fault) {
  return invoke(root, ['--tag', tag, '--repo', upstream, ...extra], fault);
}

function passes(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function fails(result, pattern, status = 1) {
  assert.equal(result.status, status, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, pattern);
}

function lockEntries(mount) {
  const text = fs.readFileSync(path.join(mount, '.sync-lock'), 'utf8');
  assert.ok(!text.includes('\r') && !text.startsWith('\uFEFF'));
  const entries = text.split('---\n')[1].trimEnd().split('\n');
  for (const entry of entries) assert.match(entry, /^[0-9a-f]{64}  .+$/);
  return entries.map(entry => [entry.slice(66), entry.slice(0, 64)]);
}

function gitPayload(tag, repository = upstream) {
  const tree = git(['ls-tree', '-r', '-z', `refs/tags/${tag}`], repository, { encoding: null });
  const text = tree.toString('utf8');
  assert.deepEqual(Buffer.from(text, 'utf8'), tree, 'Git tree names are not valid UTF-8');
  const expected = new Map();
  for (const record of text.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([0-9a-f]+)\t(.+)$/.exec(record);
    assert.ok(match, record);
    const [, mode, object, relative] = match;
    if (relative === '.sync-lock') continue;
    expected.set(relative, { mode, bytes: git(['cat-file', 'blob', object], repository, { encoding: null }) });
  }
  return expected;
}

function indexedSource(context, files, format = 'sha1') {
  const repository = fs.mkdtempSync(path.join(temporary, 'indexed-source-'));
  context.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  const initialized = execute(process.platform === 'win32' ? 'git.exe' : 'git', [
    '--no-pager', '-c', 'init.templateDir=', 'init', '--quiet', `--object-format=${format}`, repository,
  ], temporary);
  if (format === 'sha256' && initialized.status !== 0 && /unknown (option|hash)|unsupported/i.test(initialized.stderr)) {
    context.skip(`Local Git lacks SHA-256 support: ${initialized.stderr.trim()}`);
    return null;
  }
  passes(initialized);
  for (const [relative, bytes] of files) {
    const object = git(['hash-object', '-w', '--stdin'], repository, { input: bytes, stdio: ['pipe', 'pipe', 'pipe'] });
    git(['update-index', '--add', '--cacheinfo', `100644,${object},${relative}`], repository);
  }
  git(['commit', '--quiet', '-m', 'Fixture raw indexed payload'], repository);
  git(['tag', '-a', 'v1.0.0', '-m', 'Fixture annotated tag'], repository);
  return repository;
}

function rawNameSource(context, files) {
  const repository = indexedSource(context, [['original.txt', 'original payload\n']]);
  const records = files.slice().sort(([left], [right]) => Buffer.compare(left, right)).map(([name, bytes]) => {
    const object = git(['hash-object', '-w', '--stdin'], repository, { input: bytes, stdio: ['pipe', 'pipe', 'pipe'] });
    return Buffer.concat([Buffer.from(`100644 blob ${object}\t`), name, Buffer.from([0])]);
  });
  const input = Buffer.concat(records);
  const tree = git(['mktree', '-z'], repository, { input, stdio: ['pipe', 'pipe', 'pipe'] });
  const commit = git(['commit-tree', tree, '-p', 'HEAD', '-m', 'Fixture raw-name tree'], repository);
  git(['update-ref', 'refs/tags/v2.0.0', commit], repository);
  assert.deepEqual(git(['ls-tree', '-r', '-z', 'refs/tags/v2.0.0'], repository, { encoding: null }), input);
  return repository;
}

function assertGitPayload(mount, expected) {
  assert.ok(!fs.existsSync(path.join(mount, '.git')));
  assert.deepEqual(Object.keys(snapshot(mount)).filter(relative => relative !== '.sync-lock').sort(), [...expected.keys()].sort());
  for (const [relative, { mode, bytes }] of expected) {
    const full = path.join(mount, relative);
    assert.deepEqual(fs.readFileSync(full), bytes, relative);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(full).mode & 0o111, mode === '100755' ? 0o111 : 0, relative);
    }
  }
}

function assertLockMetadata(text, tag, startedAt, repository = upstream) {
  const header = text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').split('\n---\n')[0];
  const fields = header.split('\n').filter(line => line && !line.startsWith('#'));
  assert.equal(fields.length, 4);
  const metadata = Object.fromEntries(fields.map(line => {
    const separator = line.indexOf('=');
    assert.ok(separator > 0, line);
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  const timestamp = Date.parse(metadata.synced_at);
  assert.ok(timestamp >= Math.floor(startedAt / 1000) * 1000 && timestamp <= Date.now(), metadata.synced_at);
  assert.deepEqual(metadata, {
    tag, commit: git(['rev-parse', '--short', `refs/tags/${tag}^{commit}`], repository),
    url: repository, synced_at: metadata.synced_at,
  });
}

function assertGitLock(mount, tag, expected, startedAt, repository = upstream) {
  assertLockMetadata(fs.readFileSync(path.join(mount, '.sync-lock'), 'utf8'), tag, startedAt, repository);
  assert.deepEqual(lockEntries(mount), [...expected].map(([relative, { bytes }]) => [
    relative, createHash('sha256').update(bytes).digest('hex'),
  ]).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

function assertConsumerUnchanged(root, original) {
  assert.deepEqual(Object.fromEntries(Object.entries(snapshot(root))
    .filter(([relative]) => !relative.startsWith('.copilot-toolkit/'))), original);
}

before(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-sync-test-'));
  upstream = path.join(temporary, 'upstream space \u6d4b\u8bd5');
  fs.mkdirSync(upstream);
  fs.mkdirSync(path.join(temporary, 'no-hooks'));
  env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT_|NODE_OPTIONS$)/i.test(key)));
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
    GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
    GIT_AUTHOR_NAME: 'Sync Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Sync Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    HOME: temporary, USERPROFILE: temporary, XDG_CONFIG_HOME: temporary,
  });
  bootstrap = path.join(temporary, 'download only', 'sync.mjs');
  fs.mkdirSync(path.dirname(bootstrap));
  fs.copyFileSync(installer, bootstrap);
  faultModule = path.join(temporary, 'fault.cjs');
  fs.writeFileSync(faultModule, `
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const fault = process.env.SYNC_TEST_FAULT;
const originalSpawn = childProcess.spawnSync;
childProcess.spawnSync = function(command, args, options) {
  if (fault === 'no-materialization' && args.includes('cat-file')) {
    throw new Error('Unexpected payload materialization before path validation');
  }
  if (fault === 'git-settings') {
    for (const [key, value] of Object.entries(JSON.parse(process.env.SYNC_TEST_GIT_ENV))) {
      assert.equal(options.env[key] ?? null, value, key);
    }
    assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(options.env.GCM_INTERACTIVE, 'Never');
    assert.equal(options.stdio[0], 'ignore');
    assert.ok(options.timeout > 0 && options.timeout <= 60000);
    assert.ok(args.includes('credential.interactive=false'));
    if (args.includes('fetch')) {
      const prefix = args.slice(0, args.indexOf('fetch'));
      for (const [key, value] of Object.entries(JSON.parse(process.env.SYNC_TEST_GIT_CONFIG))) {
        const result = originalSpawn(command, [...prefix, 'config', '--get', key], options);
        assert.equal(result.status, 0, key);
        assert.equal(result.stdout.trim(), value, key);
      }
      console.log('Fixture Git settings verified');
    }
  }
  return originalSpawn(command, args, options);
};
const originalRename = fs.renameSync;
const originalRemove = fs.rmSync;
const originalWrite = fs.writeFileSync;
fs.renameSync = function(source, destination) {
  if (path.basename(source) === 'tree' && ['activation', 'restoration'].includes(fault)) {
    throw new Error('injected activation failure');
  }
  if (path.basename(source) === 'backup' && fault === 'restoration') {
    throw new Error('injected restoration failure');
  }
  return originalRename(source, destination);
};
fs.rmSync = function(target, options) {
  if (path.basename(target) === 'backup' && fault === 'backup-cleanup') {
    throw new Error('injected backup cleanup failure');
  }
  if (path.basename(target).startsWith('.copilot-toolkit-sync-') && fault === 'stage-cleanup') {
    throw new Error('injected staging cleanup failure');
  }
  return originalRemove(target, options);
};
fs.writeFileSync = function(file, ...args) {
  const stagedLock = path.basename(file) === '.sync-lock' && path.basename(path.dirname(file)) === 'tree';
  if (stagedLock && fault === 'staging') throw new Error('injected staging failure');
  const result = originalWrite(file, ...args);
  if (stagedLock && fault === 'target-change') {
    originalWrite(path.join(process.cwd(), '.copilot-toolkit', 'README.md'), 'concurrent edit');
  }
  return result;
};
`);
  git(['init', '--quiet', '.']);
  write(upstream, 'README.md', 'first release\n');
  write(upstream, '.github/skills/sample/SKILL.md', 'fixture skill\n');
  write(upstream, '.github/.hidden', 'hidden configuration\n');
  write(upstream, 'nested/.dotfile', 'nested hidden file\n');
  write(upstream, 'nested/.sync-lock', 'ordinary nested lock\n');
  write(upstream, 'space \u6587\u4ef6.txt', Buffer.from([0, 10, 13, 128, 255]));
  write(upstream, 'ordinary-hidden.txt', 'ordinary file with hidden attribute\n');
  write(upstream, '.sync-lock', 'upstream lock must not be copied as metadata\n');
  write(upstream, 'bin/fixture.sh', '#!/bin/sh\nprintf "fixture executable\\n"\n');
  if (process.platform !== 'win32') fs.chmodSync(path.join(upstream, 'bin/fixture.sh'), 0o755);
  git(['add', '--all']);
  git(['update-index', '--chmod=+x', 'bin/fixture.sh']);
  git(['commit', '--quiet', '-m', 'Fixture first tag']);
  firstCommit = git(['rev-parse', 'HEAD']);
  git(['tag', 'v1.0.0']);
  git(['tag', 'v1.0.1']);
  write(upstream, 'README.md', 'second release\n');
  write(upstream, 'new.txt', 'added in second release\n');
  write(upstream, 'install/sync.mjs', 'fixture newer entry point\n');
  git(['add', '--all']);
  git(['commit', '--quiet', '-m', 'Fixture second tag']);
  git(['tag', '-a', 'v2.0.0', '-m', 'Fixture annotated tag']);
  git(['branch', 'v1.0.0']);
  git(['branch', 'v9.9.9']);
});

after(() => {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
});

for (const [version, accepted] of [['18.20.8', false], ['22.0.0', false], ['24.0.0', true]]) {
  test(`simulated Node ${version} enforces the installer baseline before mutation`, context => {
    const { root, mount } = consumer(context);
    const preload = path.join(temporary, `simulated-node-${version}.cjs`);
    fs.writeFileSync(preload, `
Object.defineProperty(process.versions, 'node', { value: '${version}' });
Object.defineProperty(process, 'version', { value: 'v${version}' });
if (!${accepted}) {
  const fs = require('node:fs');
  for (const method of ['mkdirSync', 'mkdtempSync', 'rmSync', 'renameSync', 'writeFileSync', 'chmodSync']) {
    fs[method] = () => { throw new Error('Unexpected filesystem mutation: ' + method); };
  }
}
`);
    const simulated = args => execute(process.execPath, ['--require', preload, bootstrap, ...args], root);
    const original = snapshot(root);
    const originalEntries = fs.readdirSync(root);
    const installResult = simulated(['--tag', 'v1.0.0', '--repo', upstream]);
    if (accepted) {
      passes(installResult);
      assertGitPayload(mount, gitPayload('v1.0.0'));
      passes(simulated(['--uninstall']));
      assert.deepEqual(snapshot(root), original);
    } else {
      fails(installResult, /Node\.js 24\+.*v(?:18|22)\./);
      assert.match(installResult.stderr, /24 LTS.*https:\/\/nodejs\.org/);
      assert.deepEqual(snapshot(root), original);
      assert.deepEqual(fs.readdirSync(root), originalEntries);
      passes(sync(root));
      const installed = snapshot(root);
      fails(simulated(['--uninstall']), /Node\.js 24\+.*v(?:18|22)\./);
      assert.deepEqual(snapshot(root), installed);
    }
    const helpResult = simulated(['--help']);
    passes(helpResult);
    assert.match(helpResult.stdout, /Node 24\+ and Git 2\.29\+/);
  });
}

test('Git-selected tag payload and lock match independent tree/blob objects throughout standalone lifecycle', context => {
  const { root, mount } = consumer(context);
  git(['init', '--quiet', '.'], root);
  git(['add', '--all'], root);
  git(['commit', '--quiet', '-m', 'Fixture consumer'], root);
  const original = snapshot(root);
  for (const tag of ['v1.0.0', 'v1.0.0', 'v2.0.0', 'v1.0.0']) {
    const expected = gitPayload(tag);
    assert.equal(expected.get('bin/fixture.sh').mode, '100755');
    const startedAt = Date.now();
    passes(sync(root, tag));
    assertGitPayload(mount, expected);
    assertGitLock(mount, tag, expected, startedAt);
    assertConsumerUnchanged(root, original);
  }
  passes(invoke(root, ['--uninstall']));
  passes(invoke(root, ['--uninstall']));
  assert.deepEqual(snapshot(root), original);
  assert.deepEqual(fs.readdirSync(path.dirname(bootstrap)), ['sync.mjs']);
});

test('raw Git invalid UTF-8 names refuse initial install and upgrade before any payload write', context => {
  const source = rawNameSource(context, [
    [Buffer.from('a-first.txt'), Buffer.from('must not be materialized\n')],
    [Buffer.from([0x66, 0x6f, 0x80]), Buffer.from('invalid-name payload\n')],
  ]);
  assert.throws(() => gitPayload('v2.0.0', source), /not valid UTF-8/);
  const { root, mount } = consumer(context);
  const original = snapshot(root);
  const originalEntries = fs.readdirSync(root);
  const args = ['--tag', 'v2.0.0', '--repo', source];
  for (const fault of [undefined, 'no-materialization']) {
    fails(invoke(root, args, fault), /UTF-8/);
    assert.equal(fs.existsSync(mount), false);
    assert.deepEqual(snapshot(root), original);
    assert.deepEqual(fs.readdirSync(root), originalEntries);
  }
  passes(invoke(root, ['--tag', 'v1.0.0', '--repo', source]));
  assertGitPayload(mount, gitPayload('v1.0.0', source));
  const installed = snapshot(root);
  const installedEntries = fs.readdirSync(root);
  for (const extra of [[], ['--force']]) {
    for (const fault of [undefined, 'no-materialization']) {
      fails(invoke(root, [...args, ...extra], fault), /UTF-8/);
      assert.deepEqual(snapshot(root), installed);
      assert.deepEqual(fs.readdirSync(root), installedEntries);
    }
  }
});

test('raw Git valid UTF-8 replacement character and ordinary Unicode names retain exact bytes', context => {
  const files = [
    [Buffer.from([0x66, 0x6f, 0xef, 0xbf, 0xbd]), Buffer.from('literal replacement character\n')],
    [Buffer.from('ordinary-\u6d4b\u8bd5.txt', 'utf8'), Buffer.from([0, 10, 13, 128, 255])],
  ];
  const source = rawNameSource(context, files);
  const expected = gitPayload('v2.0.0', source);
  const { root, mount } = consumer(context);
  const original = snapshot(root);
  for (const extra of [[], [], ['--force']]) {
    passes(invoke(root, ['--tag', 'v2.0.0', '--repo', source, ...extra]));
    assertGitPayload(mount, expected);
    assert.deepEqual(fs.readdirSync(mount, { encoding: 'buffer' }).sort(Buffer.compare),
      [Buffer.from('.sync-lock'), ...files.map(([name]) => name)].sort(Buffer.compare));
    assertConsumerUnchanged(root, original);
  }
  passes(invoke(root, ['--uninstall']));
  assert.deepEqual(snapshot(root), original);
});

test('POSIX actual invalid-byte filename is rejected without lossy renaming', {
  skip: process.platform === 'win32' ? 'POSIX byte filenames are not supported on Windows' : false,
}, context => {
  const source = indexedSource(context, [['original.txt', 'original payload\n']]);
  const name = Buffer.from([0x66, 0x6f, 0x80]);
  const bytes = Buffer.from('actual invalid-byte filename\n');
  fs.writeFileSync(Buffer.concat([Buffer.from(`${source}/`), name]), bytes);
  assert.ok(fs.readdirSync(source, { encoding: 'buffer' }).some(entry => entry.equals(name)));
  git(['add', '--all'], source);
  git(['commit', '--quiet', '-m', 'Fixture actual POSIX byte filename'], source);
  git(['tag', 'v2.0.0'], source);
  const object = git(['hash-object', '--stdin'], source, { input: bytes, stdio: ['pipe', 'pipe', 'pipe'] });
  assert.deepEqual(git(['ls-tree', '-r', '-z', 'refs/tags/v2.0.0'], source, { encoding: null }),
    Buffer.concat([Buffer.from(`100644 blob ${object}\t`), name, Buffer.from([0])]));
  const { root, mount } = consumer(context);
  const original = snapshot(root);
  fails(invoke(root, ['--tag', 'v2.0.0', '--repo', source]), /UTF-8/);
  assert.equal(fs.existsSync(mount), false);
  assert.deepEqual(snapshot(root), original);
  passes(invoke(root, ['--tag', 'v1.0.0', '--repo', source]));
  const installed = snapshot(root);
  const names = fs.readdirSync(mount, { encoding: 'buffer' });
  fails(invoke(root, ['--tag', 'v2.0.0', '--repo', source]), /UTF-8/);
  assert.deepEqual(snapshot(root), installed);
  assert.deepEqual(fs.readdirSync(mount, { encoding: 'buffer' }), names);
});

for (const [label, separator] of [['U+2028', '\u2028'], ['U+2029', '\u2029']]) {
  test(`repository dirname with ${label} preserves lock metadata through the complete lifecycle`, context => {
    const source = path.join(temporary, `upstream-${separator}=full-value`);
    fs.cpSync(upstream, source, { recursive: true });
    context.after(() => fs.rmSync(source, { recursive: true, force: true }));
    const sourceOriginal = snapshot(source);
    const { root, mount } = consumer(context);
    git(['init', '--quiet', '.'], root);
    git(['add', '--all'], root);
    git(['commit', '--quiet', '-m', 'Fixture consumer with unusual upstream path'], root);
    const original = snapshot(root);
    const install = (tag, extra = []) => {
      const startedAt = Date.now();
      const expected = gitPayload(tag, source);
      passes(invoke(root, ['--tag', tag, '--repo', source, ...extra]));
      assertGitPayload(mount, expected);
      assertGitLock(mount, tag, expected, startedAt, source);
      assertConsumerUnchanged(root, original);
      assert.deepEqual(snapshot(source), sourceOriginal);
    };
    for (const [tag, extra] of [['v1.0.0', []], ['v1.0.0', []], ['v1.0.0', ['--force']],
      ['v2.0.0', []], ['v1.0.0', []]]) {
      install(tag, extra);
    }
    const lockFile = path.join(mount, '.sync-lock');
    fs.writeFileSync(lockFile, `\uFEFF${fs.readFileSync(lockFile, 'utf8').replaceAll('\n', '\r\n')}`);
    install('v1.0.0');
    write(mount, 'README.md', 'genuine tracked edit\n');
    const edited = snapshot(root);
    fails(invoke(root, ['--tag', 'v2.0.0', '--repo', source]), /Local edits detected/);
    assert.deepEqual(snapshot(root), edited);
    install('v2.0.0', ['--force']);
    for (const extra of [[], ['--force']]) {
      write(mount, 'README.md', 'edited before explicit uninstall\n');
      passes(invoke(root, ['--uninstall', ...extra]));
      assert.equal(fs.existsSync(mount), false);
      assert.deepEqual(snapshot(root), original);
      passes(invoke(root, ['--uninstall', ...extra]));
      assert.deepEqual(snapshot(root), original);
      if (!extra.length) install('v1.0.0');
    }
    assert.deepEqual(snapshot(source), sourceOriginal);
  });
}

test('source Unicode line separators remain unsupported before payload writes', context => {
  for (const separator of ['\u2028', '\u2029']) {
    const source = rawNameSource(context, [
      [Buffer.from('a-first.txt'), Buffer.from('must not be materialized\n')],
      [Buffer.from(`file${separator}name.txt`), Buffer.from('unsupported source name\n')],
    ]);
    const { root, mount } = consumer(context);
    const original = snapshot(root);
    const args = ['--tag', 'v2.0.0', '--repo', source];
    fails(invoke(root, args, 'no-materialization'), /Unsupported source link or special entry/);
    assert.equal(fs.existsSync(mount), false);
    assert.deepEqual(snapshot(root), original);
    passes(invoke(root, ['--tag', 'v1.0.0', '--repo', source]));
    const installed = snapshot(root);
    fails(invoke(root, [...args, '--force'], 'no-materialization'), /Unsupported source link or special entry/);
    assert.deepEqual(snapshot(root), installed);
  }
});

test('lock headers reject CR injection and unknown or duplicate keys without loosening manifest parsing', context => {
  const { root, mount } = consumer(context);
  passes(sync(root));
  const lockFile = path.join(mount, '.sync-lock');
  const valid = fs.readFileSync(lockFile, 'utf8');
  for (const invalid of [
    valid.replace('url=', 'url=unexpected\r'),
    valid.replace('url=', 'unknown='),
    valid.replace('url=', 'url=injected\nurl='),
    valid.replace('url=', 'url=injected\r\nurl='),
    ...['\u2028', '\u2029'].map(separator => `${valid}${'a'.repeat(64)}  file${separator}name.txt\n`),
  ]) {
    fs.writeFileSync(lockFile, invalid);
    const original = snapshot(root);
    fails(sync(root, 'v2.0.0', ['--force']), /Malformed/);
    fails(invoke(root, ['--uninstall', '--force']), /Malformed/);
    assert.deepEqual(snapshot(root), original);
  }
});

for (const autocrlf of ['true', 'false']) {
  test(`consumer autocrlf=${autocrlf} install-commit-checkout-resync preserves newline equivalence`, context => {
    const { root, mount } = consumer(context);
    git(['init', '--quiet', '.'], root);
    git(['config', 'core.autocrlf', autocrlf], root);
    passes(sync(root));
    assertGitPayload(mount, gitPayload('v1.0.0'));
    git(['-c', `core.autocrlf=${autocrlf}`, 'add', '--all'], root);
    git(['commit', '--quiet', '-m', 'Fixture installed overlay'], root);
    fs.rmSync(mount, { recursive: true });
    git(['-c', `core.autocrlf=${autocrlf}`, 'checkout', '--', '.copilot-toolkit'], root);
    assert.equal(fs.readFileSync(path.join(mount, 'README.md'), 'utf8'),
      autocrlf === 'true' ? 'first release\r\n' : 'first release\n');
    assert.equal(git(['-c', `core.autocrlf=${autocrlf}`, 'status', '--porcelain'], root), '');
    passes(sync(root));
    assertGitPayload(mount, gitPayload('v1.0.0'));
  });
  test(`consumer autocrlf=${autocrlf} refuses real text and binary edits even when committed and Git-clean`, context => {
    for (const committed of [false, true]) {
      for (const [relative, bytes] of [['README.md', 'real edit\r\n'],
        ['space \u6587\u4ef6.txt', Buffer.from([0, 13, 10, 13, 128, 254])]]) {
        const { root, mount } = consumer(context);
        git(['init', '--quiet', '.'], root);
        git(['config', 'core.autocrlf', autocrlf], root);
        passes(sync(root));
        git(['-c', `core.autocrlf=${autocrlf}`, 'add', '--all'], root);
        git(['commit', '--quiet', '-m', 'Fixture overlay'], root);
        write(mount, relative, bytes);
        if (committed) {
          git(['-c', `core.autocrlf=${autocrlf}`, 'add', '--all'], root);
          git(['commit', '--quiet', '-m', 'Fixture genuine local edit'], root);
          assert.equal(git(['-c', `core.autocrlf=${autocrlf}`, 'status', '--porcelain'], root), '');
        }
        const original = snapshot(root);
        fails(sync(root), /Local edits detected/);
        assert.deepEqual(snapshot(root), original);
      }
    }
  });
}

test('newline equivalence rejects non-text, binary, filtered and encoded transformations', context => {
  for (const rule of ['none', '-text', 'binary', 'text filter=visible', 'text working-tree-encoding=UTF-8', 'encoded']) {
    const { root, mount } = consumer(context);
    git(['init', '--quiet', '.'], root);
    git(['config', 'core.autocrlf', rule === 'none' ? 'false' : 'true'], root);
    if (rule !== 'none' && rule !== 'encoded') write(root, '.gitattributes', `.copilot-toolkit/README.md ${rule}\n`);
    passes(sync(root));
    git(['add', '--all'], root);
    git(['commit', '--quiet', '-m', 'Fixture newline negative control'], root);
    write(mount, 'README.md', rule === 'encoded' ? Buffer.from('first release\r\n', 'utf16le') : 'first release\r\n');
    const original = snapshot(root);
    fails(sync(root), /Local edits detected.*README\.md/);
    assert.deepEqual(snapshot(root), original);
  }
  const source = indexedSource(context, [['zero-byte.bin', Buffer.from([0, 13, 10, 255])],
    ['control.bin', Buffer.from([1, 2, 3, 13, 10, 4, 5])]]);
  for (const relative of ['zero-byte.bin', 'control.bin']) {
    const { root, mount } = consumer(context);
    git(['init', '--quiet', '.'], root);
    git(['config', 'core.autocrlf', 'true'], root);
    passes(invoke(root, ['--tag', 'v1.0.0', '--repo', source]));
    git(['add', '--all'], root);
    git(['commit', '--quiet', '-m', 'Fixture binary control'], root);
    const raw = fs.readFileSync(path.join(mount, relative));
    write(mount, relative, Buffer.from(raw.toString('latin1').replaceAll('\r\n', '\n'), 'latin1'));
    const original = snapshot(root);
    fails(invoke(root, ['--tag', 'v1.0.0', '--repo', source]), /Local edits detected/);
    assert.deepEqual(snapshot(root), original);
  }
});

test('Git-clean filtered edits refuse sync without executing the configured clean filter', context => {
  const { root, mount } = consumer(context);
  git(['init', '--quiet', '.'], root);
  passes(sync(root));
  write(root, '.gitattributes', '.copilot-toolkit/README.md text filter=mask\n');
  const marker = path.join(root, 'clean-ran');
  const filter = path.join(root, 'clean.cjs');
  write(root, 'clean.cjs', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.stdout.write('first release\\n');`);
  git(['config', 'filter.mask.clean', `"${process.execPath.replaceAll('\\', '/')}" "${filter.replaceAll('\\', '/')}"`], root);
  write(root, '.gitignore', 'clean-ran\n');
  git(['add', '--all'], root);
  git(['commit', '--quiet', '-m', 'Fixture masked clean filter'], root);
  for (const content of ['genuine edit hidden by clean filter\n', 'first release\r\n']) {
    write(mount, 'README.md', content);
    git(['add', '--', '.copilot-toolkit/README.md'], root);
    assert.equal(git(['status', '--porcelain'], root), '');
    assert.ok(fs.existsSync(marker), 'Consumer Git must actually exercise the configured clean filter');
    fs.rmSync(marker);
    const original = snapshot(root);
    fails(sync(root), /Local edits detected.*README\.md/);
    assert.ok(!fs.existsSync(marker), 'Installer must not execute a clean filter to verify edits');
    assert.deepEqual(snapshot(root), original);
  }
});

test('explicit text attributes allow reverse LF-to-raw-CRLF equivalence without autocrlf', context => {
  const source = indexedSource(context, [['README.md', 'raw CRLF\r\n']]);
  const { root, mount } = consumer(context);
  git(['init', '--quiet', '.'], root);
  git(['config', 'core.autocrlf', 'false'], root);
  write(root, '.gitattributes', '.copilot-toolkit/README.md text eol=lf\n');
  passes(invoke(root, ['--tag', 'v1.0.0', '--repo', source]));
  assertGitPayload(mount, gitPayload('v1.0.0', source));
  git(['add', '--all'], root);
  git(['commit', '--quiet', '-m', 'Fixture CRLF source'], root);
  fs.rmSync(path.join(mount, 'README.md'));
  git(['checkout', '--', '.copilot-toolkit/README.md'], root);
  assert.equal(fs.readFileSync(path.join(mount, 'README.md'), 'utf8'), 'raw CRLF\n');
  assert.equal(git(['status', '--porcelain'], root), '');
  passes(invoke(root, ['--tag', 'v1.0.0', '--repo', source]));
  assertGitPayload(mount, gitPayload('v1.0.0', source));
});

for (const format of ['sha1', 'sha256']) {
  test(`source object format ${format} overrides opposite inherited initialization defaults`, context => {
    const source = indexedSource(context, [['README.md', 'raw source\n']], format);
    if (!source) return;
    const { root, mount } = consumer(context);
    const opposite = format === 'sha1' ? 'sha256' : 'sha1';
    passes(invoke(root, ['--tag', 'v1.0.0', '--repo', source], undefined, {
      GIT_DEFAULT_HASH: opposite, GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'init.defaultObjectFormat', GIT_CONFIG_VALUE_0: opposite,
    }));
    assertGitPayload(mount, gitPayload('v1.0.0', source));
  });
}

test('raw blobs ignore global and committed attributes without executing smudge filters', context => {
  const source = indexedSource(context, [
    ['.gitattributes', '*.txt text eol=crlf\n*.dat filter=visible\n'],
    ['local.txt', 'committed attribute\n'], ['global.md', 'global attribute\n'],
    ['filtered.dat', Buffer.from([0, 255, 13, 10, 128, 10])],
  ]);
  const { root, mount } = consumer(context);
  const marker = path.join(root, 'filter-ran');
  const filter = path.join(root, 'smudge.cjs');
  write(root, 'smudge.cjs', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.stdout.write('CHANGED');`);
  const attributes = path.join(root, 'global.attributes');
  write(root, 'global.attributes', '*.md text eol=crlf\n');
  const config = path.join(root, 'fixture.gitconfig');
  git(['config', '--file', config, 'core.attributesFile', attributes], root);
  git(['config', '--file', config, 'filter.visible.smudge', `"${process.execPath.replaceAll('\\', '/')}" "${filter.replaceAll('\\', '/')}"`], root);
  git(['config', '--file', config, 'filter.visible.required', 'true'], root);
  const original = snapshot(root);
  passes(invoke(root, ['--tag', 'v1.0.0', '--repo', source], undefined, { GIT_CONFIG_GLOBAL: config }));
  assert.ok(!fs.existsSync(marker), 'Installer must not execute the configured filter');
  assertGitPayload(mount, gitPayload('v1.0.0', source));
  assertConsumerUnchanged(root, original);
});

test('index-built source case and prefix collisions are validated before payload writes', context => {
  const { root, mount } = consumer(context);
  passes(sync(root));
  for (const names of [['Foo', 'foo'], ['Foo', 'foo/nested.txt'], ['Foo/one.txt', 'foo/two.txt']]) {
    const source = indexedSource(context, names.map(relative => [relative, `${relative}\n`]));
    const original = snapshot(root);
    const insensitive = ['win32', 'darwin'].includes(process.platform);
    const result = invoke(root, ['--tag', 'v1.0.0', '--repo', source], insensitive ? 'no-materialization' : undefined);
    if (insensitive) {
      fails(result, /filesystem-equivalent path/);
      assert.deepEqual(snapshot(root), original);
    } else {
      passes(result);
      assertGitPayload(mount, gitPayload('v1.0.0', source));
    }
  }
});

test('index-built Unicode source prefixes retain distinct names outside the Darwin policy', context => {
  const source = indexedSource(context, [['caf\u00e9', 'composed\n'], ['cafe\u0301/nested.txt', 'decomposed\n']]);
  const { root, mount } = consumer(context);
  passes(sync(root));
  const original = snapshot(root);
  const result = invoke(root, ['--tag', 'v1.0.0', '--repo', source], process.platform === 'darwin' ? 'no-materialization' : undefined);
  if (process.platform === 'darwin') {
    fails(result, /filesystem-equivalent path/);
    assert.deepEqual(snapshot(root), original);
  } else {
    passes(result);
    assertGitPayload(mount, gitPayload('v1.0.0', source));
    assert.deepEqual(lockEntries(mount).map(([relative]) => relative).sort(), ['caf\u00e9', 'cafe\u0301/nested.txt'].sort());
  }
});

test('native case-equivalent registrations and index gitlinks protect absent and empty mounts', context => {
  const { root, mount } = consumer(context);
  git(['init', '--quiet', '.'], root);
  for (const registration of ['modules', 'index']) {
    if (registration === 'modules') write(root, '.gitmodules', '[submodule "fixture"]\n\tpath = .COPILOT-TOOLKIT/nested\n');
    else git(['update-index', '--add', '--cacheinfo', `160000,${firstCommit},.COPILOT-TOOLKIT/nested`], root);
    for (const empty of [false, true]) {
      if (empty) fs.mkdirSync(mount);
      const original = snapshot(root);
      if (['win32', 'darwin'].includes(process.platform)) {
        fails(sync(root, 'v1.0.0', ['--force']), /submodule target/);
        fails(invoke(root, ['--uninstall', '--force']), /submodule target/);
        assert.deepEqual(snapshot(root), original);
        assert.equal(fs.existsSync(mount), empty);
      } else {
        passes(sync(root));
        passes(invoke(root, ['--uninstall']));
        assert.deepEqual(snapshot(root), original);
      }
      if (fs.existsSync(mount)) fs.rmSync(mount, { recursive: true });
    }
    if (registration === 'modules') fs.rmSync(path.join(root, '.gitmodules'));
  }
});

test('Darwin path policy simulation covers Unicode prefixes, lock duplicates and absent or empty ownership', context => {
  const source = fs.readFileSync(installer, 'utf8');
  const functions = source.slice(source.indexOf('function statIfPresent('), source.indexOf('function acquire('));
  const policy = vm.runInNewContext(`${functions}\n({ readLock, registerPath, checkRegistration, inspectTarget });`, {
    fs, path, createHash, Buffer, process: { platform: 'darwin' }, lockName: '.sync-lock', mountName: '.copilot-toolkit',
    git: (args, cwd, allowNoMatch) => {
      const result = execute(process.platform === 'win32' ? 'git.exe' : 'git', ['--no-pager', ...args], cwd);
      assert.ok(result.status === 0 || (allowNoMatch && result.status === 1), result.stderr);
      return result.stdout;
    },
  });
  for (const names of [['Foo', 'foo'], ['Foo', 'foo/nested.txt'],
    ['caf\u00e9', 'cafe\u0301/nested.txt'], ['caf\u00e9/one', 'cafe\u0301/two']]) {
    const seen = new Map();
    policy.registerPath(seen, names[0]);
    assert.throws(() => policy.registerPath(seen, names[1]), /filesystem-equivalent path/);
  }
  const { root, mount } = consumer(context);
  passes(sync(root));
  const lock = fs.readFileSync(path.join(mount, '.sync-lock'), 'utf8');
  assert.throws(() => policy.readLock(`${lock}${'0'.repeat(64)}  readme.md\n`), /filesystem-equivalent path/);
  assert.throws(() => policy.readLock(`${lock}${'0'.repeat(64)}  caf\u00e9\n${'1'.repeat(64)}  cafe\u0301/child\n`), /filesystem-equivalent path/);
  fs.renameSync(path.join(mount, 'README.md'), path.join(mount, 'cafe\u0301'));
  write(mount, '.sync-lock', lock.replace('  README.md\n', '  caf\u00e9\n'));
  write(mount, 'cafe\u0301', 'real edit under filesystem-normalized name\n');
  assert.throws(() => policy.inspectTarget(root, mount, {}, false), /Local edits detected.*caf\u00e9/);
  write(mount, 'cafe\u0301', 'first release\n');
  assert.doesNotThrow(() => policy.inspectTarget(root, mount, {}, false));
  const target = path.join(root, 'caf\u00e9', '.copilot-toolkit');
  for (const registered of ['cafe\u0301/.COPILOT-TOOLKIT', 'cafe\u0301/.COPILOT-TOOLKIT/nested']) {
    write(root, '.gitmodules', `[submodule "fixture"]\n\tpath = ${registered}\n`);
    assert.throws(() => policy.checkRegistration(root, target), /registered submodule/);
    fs.mkdirSync(target, { recursive: true });
    assert.throws(() => policy.checkRegistration(root, target), /registered submodule/);
    fs.rmSync(target, { recursive: true });
  }
  context.diagnostic('SIMULATED Darwin path policy only; Git and filesystem operations use the actual host, not a spoofed macOS executable environment.');
});

test('historical installer hands real Git payload and unchanged legacy lock to standalone lifecycle', context => {
  const baseline = '01ac8b6043d9cd14647da59c3c50cfadd8c7257a';
  const legacyTag = 'v1.0.1';
  const repository = path.resolve(path.dirname(installer), '..');
  const source = process.platform === 'win32' ? 'install/sync.ps1' : 'install/sync.sh';
  const available = execute(process.platform === 'win32' ? 'git.exe' : 'git', [
    '--no-pager', 'cat-file', '-e', `${baseline}:${source}`,
  ], repository);
  if (available.status !== 0) {
    context.skip(`Historical source unavailable in target repository: ${baseline}:${source}; ${available.stderr.trim()}`);
    return;
  }
  const shell = process.platform === 'win32' ? 'pwsh.exe' : 'bash';
  const versionArgs = process.platform === 'win32'
    ? ['-NonInteractive', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'] : ['--version'];
  const version = spawnSync(shell, versionArgs, {
    cwd: temporary, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, windowsHide: true,
  });
  if (version.error?.code === 'ENOENT') {
    context.skip(`Historical installer requires ${shell}; shell unavailable`);
    return;
  }
  assert.ifError(version.error);
  passes(version);
  if (process.platform === 'win32') assert.ok(Number(version.stdout.trim().split('.')[0]) >= 7);
  const bytes = git(['show', `${baseline}:${source}`], repository, { encoding: null });
  const script = path.join(temporary, 'historical installer', path.basename(source));
  write(path.dirname(script), path.basename(script), bytes);
  const object = git(['rev-parse', `${baseline}:${source}`], repository);
  assert.equal(git(['hash-object', '--no-filters', script], repository), object);
  const { root, mount } = consumer(context);
  git(['init', '--quiet', '.'], root);
  git(['add', '--all'], root);
  git(['commit', '--quiet', '-m', 'Fixture legacy consumer'], root);
  const original = snapshot(root);
  const expected = gitPayload(legacyTag);
  const startedAt = Date.now();
  const args = process.platform === 'win32'
    ? ['-NonInteractive', '-NoProfile', '-File', script, '-Tag', legacyTag, '-Repo', upstream]
    : [script, '--tag', legacyTag, '--repo', upstream];
  const installed = execute(shell, args, root, { env: {
    ...env, TMP: temporary, TEMP: temporary, TMPDIR: temporary, BASH_ENV: '', ENV: '',
    GIT_PAGER: 'cat', PAGER: 'cat', GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: path.join(temporary, 'no-hooks'),
    GIT_CONFIG_KEY_1: 'init.templateDir', GIT_CONFIG_VALUE_1: '',
    GIT_CONFIG_KEY_2: 'core.autocrlf', GIT_CONFIG_VALUE_2: 'false',
  } });
  passes(installed);
  assert.match(installed.stdout, /Sync complete/);
  assertGitPayload(mount, expected);
  assertConsumerUnchanged(root, original);
  const legacyLock = fs.readFileSync(path.join(mount, '.sync-lock'));
  const text = legacyLock.toString('utf8').replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  assertLockMetadata(text, legacyTag, startedAt);
  const entries = text.split('\n---\n')[1].trimEnd().split('\n').map(line => {
    assert.match(line, /^[0-9a-f]{64}  .+$/);
    return [line.slice(66), line.slice(0, 64)];
  });
  const selfEntries = entries.filter(([relative]) => relative === '.sync-lock');
  assert.equal(selfEntries.length, 1);
  assert.deepEqual(entries.filter(([relative]) => relative !== '.sync-lock').sort(), [...expected].map(([relative, entry]) => [
    relative, createHash('sha256').update(entry.bytes).digest('hex'),
  ]).sort());
  if (process.platform === 'win32') {
    const sourceLock = git(['show', `refs/tags/${legacyTag}:.sync-lock`], upstream, { encoding: null });
    assert.equal(selfEntries[0][1], createHash('sha256').update(sourceLock).digest('hex'));
  }
  context.diagnostic(`ACTUALLY RAN ${source} from ${baseline}, blob ${object}, via ${version.stdout.trim().split(/\r?\n/)[0]}`);
  context.diagnostic('Approved legacy exception: root lock self-hash is ignored during takeover; payload and other hashes are checked against Git blobs.');
  write(mount, 'README.md', 'ordinary tracked edit under real legacy lock\n');
  const editedLegacy = snapshot(root);
  fails(sync(root, 'v2.0.0'), /Local edits detected.*README\.md/);
  assert.deepEqual(snapshot(root), editedLegacy);
  write(mount, 'README.md', expected.get('README.md').bytes);
  assert.deepEqual(fs.readFileSync(path.join(mount, '.sync-lock')), legacyLock);
  for (const tag of [legacyTag, 'v2.0.0', legacyTag]) {
    const selected = gitPayload(tag);
    const syncStartedAt = Date.now();
    passes(sync(root, tag));
    assertGitPayload(mount, selected);
    assertGitLock(mount, tag, selected, syncStartedAt);
    assertConsumerUnchanged(root, original);
    if (tag === legacyTag) {
      write(mount, 'README.md', 'ordinary tracked edit after takeover\n');
      const edited = snapshot(root);
      fails(sync(root, 'v2.0.0'), /Local edits detected.*README\.md/);
      assert.deepEqual(snapshot(root), edited);
      write(mount, 'README.md', selected.get('README.md').bytes);
    }
  }
  write(mount, 'README.md', 'edited file removed by explicit uninstall\n');
  passes(invoke(root, ['--uninstall']));
  passes(invoke(root, ['--uninstall']));
  assert.deepEqual(snapshot(root), original);
  assert.deepEqual(fs.readFileSync(script), bytes);
});

test('explicit uninstall removes edited tracked files without force', context => {
  const { root, mount } = consumer(context);
  const original = snapshot(root);
  passes(sync(root));
  write(mount, 'README.md', 'local edit before explicit uninstall\n');
  passes(invoke(root, ['--uninstall']));
  assert.deepEqual(snapshot(root), original);
});

test('consumer-relative repository paths with spaces and Unicode support install and upgrade', context => {
  const { root, mount } = consumer(context);
  const original = snapshot(root);
  const relativeRepo = path.relative(root, upstream).split(path.sep).join('/');
  for (const [tag, content] of [['v1.0.0', 'first release\n'], ['v2.0.0', 'second release\n']]) {
    passes(invoke(root, ['--tag', tag, '--repo', relativeRepo]));
    assert.equal(fs.readFileSync(path.join(mount, 'README.md'), 'utf8'), content);
    const lock = fs.readFileSync(path.join(mount, '.sync-lock'), 'utf8');
    assert.ok(lock.includes(`url=${relativeRepo}\n`));
    assert.ok(lock.includes(`tag=${tag}\n`));
  }
  passes(invoke(root, ['--uninstall']));
  assert.deepEqual(snapshot(root), original);
});

test('Git transport preserves fixture global rewrites and per-invocation configuration', context => {
  const { root, mount } = consumer(context);
  const config = path.join(root, 'fixture.gitconfig');
  const hooks = path.join(root, 'fixture-hooks');
  const source = pathToFileURL(upstream).href;
  const aliases = ['fixture-global', 'fixture:source', 'https://fixture.invalid/source',
    'ssh://fixture.invalid/source', 'git@fixture.invalid:source'];
  for (const alias of aliases) {
    git(['config', '--file', config, '--add', `url.${source}.insteadOf`, alias], root);
  }
  git(['config', '--file', config, 'core.autocrlf', 'true'], root);
  git(['config', '--file', config, 'core.hooksPath', hooks], root);
  write(hooks, 'post-checkout', '#!/bin/sh\nexit 97\n');
  fs.chmodSync(path.join(hooks, 'post-checkout'), 0o755);
  const originalConfig = fs.readFileSync(config);
  const originalUpstream = snapshot(upstream);
  const configuredEnv = {
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_COUNT: '5',
    GIT_CONFIG_KEY_0: `url.${source}.insteadOf`, GIT_CONFIG_VALUE_0: 'fixture-env',
    GIT_CONFIG_KEY_1: 'core.autocrlf', GIT_CONFIG_VALUE_1: 'true',
    GIT_CONFIG_KEY_2: 'core.hooksPath', GIT_CONFIG_VALUE_2: hooks,
    GIT_CONFIG_KEY_3: 'core.worktree', GIT_CONFIG_VALUE_3: upstream,
    GIT_CONFIG_KEY_4: 'core.bare', GIT_CONFIG_VALUE_4: 'true',
    GIT_DIR: path.join(upstream, '.git'), GIT_WORK_TREE: upstream,
    GIT_COMMON_DIR: path.join(upstream, '.git'),
    GIT_INDEX_FILE: path.join(upstream, '.git/index'),
    GIT_OBJECT_DIRECTORY: path.join(upstream, '.git/objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(root, 'absent-objects'),
    GIT_NAMESPACE: 'fixture-namespace', GIT_SHALLOW_FILE: path.join(root, 'absent-shallow'),
  };
  for (const repo of [...aliases, source]) {
    passes(invoke(root, ['--tag', 'v1.0.0', '--repo', repo], undefined, configuredEnv));
    assert.equal(fs.readFileSync(path.join(mount, 'README.md'), 'utf8'), 'first release\n');
    assert.ok(fs.readFileSync(path.join(mount, '.sync-lock'), 'utf8').includes(`url=${repo}\n`));
  }
  passes(invoke(root, ['--tag', 'v2.0.0', '--repo', 'fixture-env'], undefined, configuredEnv));
  assert.equal(fs.readFileSync(path.join(mount, 'README.md'), 'utf8'), 'second release\n');
  assert.ok(fs.readFileSync(path.join(mount, '.sync-lock'), 'utf8').includes('url=fixture-env\n'));
  assert.deepEqual(fs.readFileSync(config), originalConfig);
  assert.deepEqual(snapshot(upstream), originalUpstream);
});

test('Git transport preserves credential, proxy, CA and explicit SSH settings', context => {
  const { root } = consumer(context);
  const config = path.join(root, 'fixture-global.gitconfig');
  const systemConfig = path.join(root, 'fixture-system.gitconfig');
  const transportConfig = {
    'credential.helper': 'fixture-helper',
    'core.sshCommand': 'fixture-config-ssh -F fixture-config',
    'ssh.variant': 'plink',
    'http.proxy': 'http://fixture-proxy.invalid:8080',
    'http.sslCAInfo': path.join(root, 'fixture-ca.pem'),
  };
  for (const [key, value] of Object.entries(transportConfig)) {
    git(['config', '--file', key === 'http.sslCAInfo' ? systemConfig : config, key, value], root);
  }
  const configuredEnv = {
    GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: systemConfig, GIT_CONFIG_NOSYSTEM: '0',
    GIT_CONFIG_PARAMETERS: "'http.proxy=http://fixture-env-proxy.invalid:8080'",
    GIT_ASKPASS: 'fixture-askpass', SSH_ASKPASS: 'fixture-ssh-askpass',
    GIT_SSL_CAINFO: path.join(root, 'fixture-env-ca.pem'), GIT_PROXY_COMMAND: 'fixture-proxy',
  };
  for (const sshEnv of [{}, { GIT_SSH: 'fixture-ssh', GIT_SSH_VARIANT: 'plink' },
    { GIT_SSH: 'fixture-fallback', GIT_SSH_COMMAND: 'fixture-ssh --option', GIT_SSH_VARIANT: 'ssh' }]) {
    const expectedEnv = { ...configuredEnv, GIT_SSH: null, GIT_SSH_COMMAND: null, GIT_SSH_VARIANT: null, ...sshEnv };
    const result = invoke(root, ['--tag', 'v1.0.0', '--repo', upstream], 'git-settings', {
      ...configuredEnv, ...sshEnv, GIT_TERMINAL_PROMPT: '1', GCM_INTERACTIVE: 'Always',
      SYNC_TEST_GIT_ENV: JSON.stringify(expectedEnv),
      SYNC_TEST_GIT_CONFIG: JSON.stringify({ ...transportConfig, 'http.proxy': 'http://fixture-env-proxy.invalid:8080' }),
    });
    passes(result);
    assert.match(result.stdout, /Fixture Git settings verified/);
  }
});

test('invalid invocations exit 2 without touching the consumer', context => {
  const { root } = consumer(context);
  const original = snapshot(root);
  for (const args of [[], ['--tag'], ['--repo'], ['--tag', '--force'], ['--tag', 'main'],
    ['--tag', 'v1.0.0', '--repo', '--force'], ['--unknown'], ['stray'],
    ...['\r', '\n', '\r\n'].map(separator => ['--tag', 'v1.0.0', '--repo', `${upstream}${separator}url=injected`]),
    ['--uninstall', '--tag', 'v1.0.0'], ['--uninstall', '--repo', upstream],
    ['--tag', 'v1.0.0', '--tag', 'v2.0.0'], ['--help', '--unknown']]) {
    fails(invoke(root, args), /Usage:/, 2);
  }
  passes(invoke(root, ['--help']));
  passes(invoke(root, ['-h']));
  assert.deepEqual(snapshot(root), original);
});

test('legacy BOM/CRLF locks and root self-entry work; older unlisted hidden files are replaced', context => {
  const { root, mount } = consumer(context);
  passes(sync(root));
  const lockFile = path.join(mount, '.sync-lock');
  const legacy = fs.readFileSync(lockFile, 'utf8').split('\n').filter(line => !line.includes('  .github/')).join('\n');
  fs.writeFileSync(lockFile, `\uFEFF${legacy}${'0'.repeat(64)}  .sync-lock\n`.replace(/\n/g, '\r\n'));
  write(mount, '.github/.hidden', 'legacy unprotected edit');
  passes(sync(root));
  assert.equal(fs.readFileSync(path.join(mount, '.github/.hidden'), 'utf8'), 'hidden configuration\n');
  assert.ok(!lockEntries(mount).some(([relative]) => relative === '.sync-lock'));
});

test('tracked edits refuse sync, force discards edits, missing files return', context => {
  const { root, mount } = consumer(context);
  passes(sync(root));
  write(mount, '.github/.hidden', 'local edit');
  const edited = snapshot(mount);
  fails(sync(root, 'v2.0.0'), /Local edits detected/);
  assert.deepEqual(snapshot(mount), edited);
  passes(sync(root, 'v2.0.0', ['--force']));
  fs.rmSync(path.join(mount, '.github/.hidden'));
  write(mount, 'untracked.txt', 'not protected by manifest');
  const restored = sync(root);
  passes(restored);
  assert.match(restored.stderr, /Missing: .github\/.hidden.*will be restored/);
  assert.ok(fs.existsSync(path.join(mount, '.github/.hidden')));
  assert.ok(!fs.existsSync(path.join(mount, 'untracked.txt')));
  write(mount, 'README.md', 'discard at uninstall');
  passes(invoke(root, ['--uninstall']));
});

test('ordinary Windows-hidden files remain tracked', { skip: process.platform !== 'win32' }, context => {
  const { root, mount } = consumer(context);
  passes(sync(root));
  const file = path.join(mount, 'ordinary-hidden.txt');
  write(mount, 'ordinary-hidden.txt', 'hidden local edit');
  passes(execute('attrib.exe', ['+H', file], root));
  fails(sync(root), /Local edits detected.*ordinary-hidden/);
  passes(sync(root, 'v2.0.0', ['--force']));
  assert.ok(lockEntries(mount).some(([relative]) => relative === 'ordinary-hidden.txt'));
});

test('missing repositories, missing tags and branch-only names preserve the old tree', context => {
  const { root, mount } = consumer(context);
  passes(sync(root));
  const original = snapshot(root);
  fails(sync(root, 'v8.8.8'), /Git ls-remote failed/);
  fails(sync(root, 'v9.9.9'), /Git ls-remote failed/);
  fails(invoke(root, ['--tag', 'v1.0.0', '--repo', path.join(temporary, 'absent repo')]), /Git ls-remote failed/);
  assert.deepEqual(snapshot(root), original);
  assert.ok(fs.existsSync(mount));
  assert.ok(!fs.readdirSync(root).some(name => name.startsWith('.copilot-toolkit-sync-')));
});

test('ownership checks reject unmanaged and Git targets even with force', context => {
  const { root, mount } = consumer(context);
  fs.mkdirSync(mount);
  passes(sync(root));
  const valid = fs.readFileSync(path.join(mount, '.sync-lock'));
  fs.rmSync(path.join(mount, '.sync-lock'));
  for (const args of [['--uninstall', '--force'], ['--tag', 'v1.0.0', '--repo', upstream, '--force']]) {
    fails(invoke(root, args), /unmanaged/);
  }
  fs.writeFileSync(path.join(mount, '.sync-lock'), valid);
  for (const marker of ['gitdir: ../elsewhere', null]) {
    if (marker === null) fs.mkdirSync(path.join(mount, '.git'));
    else write(mount, '.git', marker);
    const original = snapshot(mount);
    fails(sync(root, 'v2.0.0', ['--force']), /Git checkout/);
    fails(invoke(root, ['--uninstall', '--force']), /Git checkout/);
    assert.deepEqual(snapshot(mount), original);
    fs.rmSync(path.join(mount, '.git'), { recursive: true });
  }
});

test('registered submodules are refused when absent, empty or disguised by a lock', context => {
  const { root, mount } = consumer(context);
  passes(sync(root));
  write(root, '.gitmodules', '[submodule "custom-name"]\n\tpath = .copilot-toolkit\n\turl = unused\n');
  const original = snapshot(root);
  fails(sync(root, 'v2.0.0', ['--force']), /registered submodule/);
  fails(invoke(root, ['--uninstall', '--force']), /registered submodule/);
  assert.deepEqual(snapshot(root), original);
  fs.rmSync(mount, { recursive: true });
  fails(sync(root), /registered submodule/);
  fs.mkdirSync(mount);
  fails(sync(root), /registered submodule/);
  fs.rmSync(path.join(root, '.gitmodules'));
  git(['init', '--quiet', '.'], root);
  git(['update-index', '--add', '--cacheinfo', `160000,${firstCommit},.copilot-toolkit`], root);
  fails(sync(root), /Git-index submodule/);
});

test('ownership rejects index-only submodules under inherited Git configuration', async context => {
  for (const configuration of ['count', 'parameters']) {
    for (const bare of ['false', 'true']) {
      for (const operation of ['sync', 'uninstall']) {
        await context.test(`ownership with ${configuration} configuration, core.bare=${bare}, ${operation}`, subcontext => {
          const { root } = consumer(subcontext);
          git(['init', '--quiet', '.'], root);
          passes(sync(root));
          git(['update-index', '--add', '--cacheinfo', `160000,${firstCommit},.copilot-toolkit`], root);
          assert.ok(!fs.existsSync(path.join(root, '.gitmodules')));
          assert.match(git(['ls-files', '--stage', '--', '.copilot-toolkit'], root), /^160000 /);
          const workTree = path.dirname(root).replaceAll('\\', '/');
          const configuredEnv = configuration === 'count' ? {
            GIT_CONFIG_COUNT: '2',
            GIT_CONFIG_KEY_0: 'core.worktree', GIT_CONFIG_VALUE_0: workTree,
            GIT_CONFIG_KEY_1: 'core.bare', GIT_CONFIG_VALUE_1: bare,
          } : {
            GIT_CONFIG_PARAMETERS: `'core.worktree=${workTree.replaceAll("'", "'\\''")}' 'core.bare=${bare}'`,
          };
          const args = operation === 'sync'
            ? ['--tag', 'v2.0.0', '--repo', upstream, '--force'] : ['--uninstall', '--force'];
          const external = () => Object.fromEntries(Object.entries(snapshot(temporary))
            .filter(([relative]) => !relative.startsWith(`${path.basename(root)}/`)));
          const original = snapshot(root);
          const originalExternal = external();
          fails(invoke(root, args), /Git-index submodule/);
          assert.deepEqual(snapshot(root), original);
          assert.deepEqual(external(), originalExternal);
          const result = invoke(root, args, undefined, configuredEnv);
          assert.deepEqual({
            status: result.status,
            consumerUnchanged: isDeepStrictEqual(snapshot(root), original),
            externalUnchanged: isDeepStrictEqual(external(), originalExternal),
          }, { status: 1, consumerUnchanged: true, externalUnchanged: true }, `${result.stdout}\n${result.stderr}`);
          assert.match(result.stderr, /Git-index submodule/);
        });
      }
    }
  }
});

test('ownership permits normal Git consumers under inherited Git configuration', async context => {
  for (const configuration of ['count', 'parameters']) {
    for (const bare of ['false', 'true']) {
      await context.test(`ownership-compatible ${configuration} configuration, core.bare=${bare}`, subcontext => {
        const { root, mount } = consumer(subcontext);
        git(['init', '--quiet', '.'], root);
        git(['add', '--all'], root);
        git(['commit', '--quiet', '-m', 'Fixture consumer'], root);
        const workTree = path.dirname(root).replaceAll('\\', '/');
        const configuredEnv = configuration === 'count' ? {
          GIT_CONFIG_COUNT: '2',
          GIT_CONFIG_KEY_0: 'core.worktree', GIT_CONFIG_VALUE_0: workTree,
          GIT_CONFIG_KEY_1: 'core.bare', GIT_CONFIG_VALUE_1: bare,
        } : {
          GIT_CONFIG_PARAMETERS: `'core.worktree=${workTree.replaceAll("'", "'\\''")}' 'core.bare=${bare}'`,
        };
        const external = () => Object.fromEntries(Object.entries(snapshot(temporary))
          .filter(([relative]) => !relative.startsWith(`${path.basename(root)}/`)));
        const original = snapshot(root);
        const originalExternal = external();
        for (const [tag, contents] of [['v1.0.0', 'first release\n'], ['v2.0.0', 'second release\n']]) {
          passes(invoke(root, ['--tag', tag, '--repo', upstream, '--force'], undefined, configuredEnv));
          assert.equal(fs.readFileSync(path.join(mount, 'README.md'), 'utf8'), contents);
          assert.ok(fs.readFileSync(path.join(mount, '.sync-lock'), 'utf8').includes(`tag=${tag}\n`));
          assert.deepEqual(Object.fromEntries(Object.entries(snapshot(root))
            .filter(([relative]) => !relative.startsWith('.copilot-toolkit/'))), original);
          assert.deepEqual(external(), originalExternal);
        }
        assert.equal(fs.readFileSync(path.join(mount, 'new.txt'), 'utf8'), 'added in second release\n');
        passes(invoke(root, ['--uninstall', '--force'], undefined, configuredEnv));
        assert.ok(!fs.existsSync(mount));
        assert.deepEqual(snapshot(root), original);
        assert.deepEqual(external(), originalExternal);
      });
    }
  }
});

test('linked mounts and linked descendants cannot be forced', context => {
  const { root, mount } = consumer(context);
  const external = path.join(root, 'outside');
  fs.mkdirSync(external);
  write(external, 'keep.txt', 'must survive');
  fs.symlinkSync(external, mount, process.platform === 'win32' ? 'junction' : 'dir');
  fails(sync(root, 'v1.0.0', ['--force']), /linked/);
  fails(invoke(root, ['--uninstall', '--force']), /linked/);
  fs.unlinkSync(mount);
  passes(sync(root));
  fs.symlinkSync(external, path.join(mount, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  fails(sync(root, 'v2.0.0', ['--force']), /Unsupported link/);
  fails(invoke(root, ['--uninstall', '--force']), /Unsupported link/);
  assert.equal(fs.readFileSync(path.join(external, 'keep.txt'), 'utf8'), 'must survive');
});

test('invalid lock metadata and escaping or malformed manifest paths fail before replacement', context => {
  const { root, mount } = consumer(context);
  passes(sync(root));
  const lockFile = path.join(mount, '.sync-lock');
  const valid = fs.readFileSync(lockFile, 'utf8');
  const contents = snapshot(mount);
  for (const relative of ['../outside', '/absolute', 'C:/outside', '\\outside', 'nested/../../outside',
    './README.md', 'nested//file', '.git/config', 'README.md:stream', '.sync-lock/child']) {
    fs.writeFileSync(lockFile, `${valid}${'a'.repeat(64)}  ${relative}\n`);
    fails(sync(root, 'v2.0.0', ['--force']), /Unsafe/);
    fails(invoke(root, ['--uninstall', '--force']), /Unsafe/);
  }
  for (const invalid of ['not a lock', valid.replace(/^commit=.+\n/m, ''), `${valid}invalid manifest\n`, `${valid}${valid.split('---\n')[1]}`]) {
    fs.writeFileSync(lockFile, invalid);
    fails(sync(root, 'v2.0.0', ['--force']), /Malformed|Duplicate/);
  }
  fs.writeFileSync(lockFile, valid);
  assert.deepEqual(snapshot(mount), contents);
});

test('source symlinks and gitlinks are rejected before checkout and activation', context => {
  const { root, mount } = consumer(context);
  passes(sync(root));
  const original = snapshot(mount);
  write(upstream, 'link-content', 'README.md');
  const blob = git(['hash-object', '-w', 'link-content']);
  git(['update-index', '--add', '--cacheinfo', `120000,${blob},linked`]);
  git(['commit', '--quiet', '-m', 'Fixture symlink']);
  git(['tag', 'v3.0.0']);
  fails(sync(root, 'v3.0.0', ['--force']), /Unsupported source link or special entry/);
  git(['update-index', '--force-remove', 'linked']);
  git(['update-index', '--add', '--cacheinfo', `160000,${firstCommit},nested-module`]);
  git(['commit', '--quiet', '-m', 'Fixture gitlink']);
  git(['tag', 'v4.0.0']);
  fails(sync(root, 'v4.0.0', ['--force']), /Unsupported source link or special entry/);
  assert.deepEqual(snapshot(mount), original);
});

test('staging failures and activation failures preserve or restore the old tree', context => {
  const { root, mount } = consumer(context);
  passes(sync(root));
  const original = snapshot(root);
  fails(sync(root, 'v2.0.0', [], 'staging'), /injected staging failure/);
  assert.deepEqual(snapshot(root), original);
  fails(sync(root, 'v2.0.0', [], 'activation'), /Activation failed.*Old tree restored/);
  assert.deepEqual(snapshot(root), original);
  passes(invoke(root, ['--uninstall']));
  fails(sync(root, 'v2.0.0', [], 'activation'), /No prior installation was changed/);
  assert.ok(!fs.existsSync(mount));
  assert.ok(!fs.readdirSync(root).some(name => name.startsWith('.copilot-toolkit-sync-')));
});

test('destination edits made during staging refuse activation', context => {
  const { root, mount } = consumer(context);
  passes(sync(root));
  fails(sync(root, 'v2.0.0', [], 'target-change'), /Local edits detected/);
  assert.equal(fs.readFileSync(path.join(mount, 'README.md'), 'utf8'), 'concurrent edit');
  assert.ok(!fs.existsSync(path.join(mount, 'new.txt')));
});

test('failed restoration retains the old backup and reports its location', context => {
  const { root, mount } = consumer(context);
  passes(sync(root));
  const original = snapshot(mount);
  const result = sync(root, 'v2.0.0', [], 'restoration');
  fails(result, /Restoration failed.*Old tree retained at/);
  assert.ok(!fs.existsSync(mount));
  const stage = fs.readdirSync(root).find(name => name.startsWith('.copilot-toolkit-sync-'));
  const backup = path.join(root, stage, 'backup');
  assert.ok(result.stderr.includes(backup));
  assert.deepEqual(snapshot(backup), original);
});

test('backup and staging cleanup failures report the active installation and retained paths', context => {
  const { root, mount } = consumer(context);
  passes(sync(root));
  const original = snapshot(mount);
  const result = sync(root, 'v2.0.0', [], 'backup-cleanup');
  fails(result, /New installation is active.*backup cleanup failed.*retained at/);
  assert.equal(fs.readFileSync(path.join(mount, 'README.md'), 'utf8'), 'second release\n');
  const stage = fs.readdirSync(root).find(name => name.startsWith('.copilot-toolkit-sync-'));
  assert.deepEqual(snapshot(path.join(root, stage, 'backup')), original);
  fails(sync(root, 'v1.0.0', [], 'stage-cleanup'), /Staging cleanup failed.*Remnants retained at/);
  assert.equal(fs.readFileSync(path.join(mount, 'README.md'), 'utf8'), 'first release\n');
});