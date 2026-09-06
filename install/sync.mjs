#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { devNull } from 'node:os';
import path from 'node:path';

const mountName = '.copilot-toolkit';
const lockName = '.sync-lock';
const defaultRepo = 'https://github.com/test3207/copilot-toolkit.git';
const gitNull = process.platform === 'win32' ? 'NUL' : devNull;
const help = `Usage: node sync.mjs --tag vX.Y.Z [--repo <url-or-path>] [--force]
       node sync.mjs --uninstall [--force]
       node sync.mjs --help

Run from the consumer root. Requires Node 24+ and Git 2.29+.
Use a supported LTS release; Node 24 LTS is recommended.
--force discards tracked edits, never bypasses ownership checks.
Untracked files may be removed. Consumer configuration and Git state are unchanged.
Default upstream: ${defaultRepo}`;

function parseArgs(args) {
  const options = { repo: defaultRepo, force: false, uninstall: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--tag', '--repo', '--force', '--uninstall', '--help', '-h'].includes(flag)) {
      throw new Error(`Unknown option or argument: ${flag}`);
    }
    if (seen.has(flag)) throw new Error(`Repeated option: ${flag}`);
    seen.add(flag);
    if (flag === '--tag' || flag === '--repo') {
      const value = args[++index];
      if (!value || value.startsWith('-') || /[\x00-\x1f\x7f]/.test(value)) {
        throw new Error(`${flag} requires a value.`);
      }
      options[flag.slice(2)] = value;
    } else if (flag === '-h' || flag === '--help') {
      options.help = true;
    } else {
      options[flag.slice(2)] = true;
    }
  }
  if (options.help) {
    if (args.length !== 1) throw new Error('Help must be used alone.');
  } else if (options.uninstall) {
    if (options.tag || seen.has('--repo')) throw new Error('--uninstall cannot use --tag or --repo.');
  } else if (!options.tag || !/^v\d+\.\d+\.\d+$/.test(options.tag)) {
    throw new Error('--tag must be in vX.Y.Z form.');
  }
  return options;
}

function git(args, cwd, allowNoMatch = false, workTree, outputFd) {
  const repositoryEnv = new Set([
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_QUARANTINE_PATH', 'GIT_NAMESPACE',
    'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
    'GIT_INTERNAL_SUPER_PREFIX', 'GIT_IMPLICIT_WORK_TREE', 'GIT_CEILING_DIRECTORIES',
    'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_TEMPLATE_DIR', 'GIT_CONFIG',
  ]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !repositoryEnv.has(key.toUpperCase())));
  const result = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', [
    ...(workTree ? ['--git-dir', path.join(workTree, '.git'), '--work-tree', workTree, '-c', 'core.bare=false'] : []),
    '--no-pager', '-c', `core.hooksPath=${gitNull}`, '-c', 'init.templateDir=',
    '-c', 'core.fsmonitor=false',
    '-c', 'credential.interactive=false',
    '-c', 'protocol.ext.allow=never', ...args,
  ], {
    cwd, encoding: 'utf8', stdio: ['ignore', outputFd ?? 'pipe', 'pipe'], windowsHide: true,
    timeout: 60000, maxBuffer: 16 * 1024 * 1024,
    env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GCM_INTERACTIVE: 'Never' },
  });
  if (result.error || (result.status !== 0 && !(allowNoMatch && result.status === 1))) {
    throw new Error(`Git ${args[0]} failed: ${result.error?.message || result.stderr.trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function statIfPresent(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function validatePath(relative) {
  const segments = relative.split('/');
  if (!relative || /[\x00-\x1f\x7f<>:"\\|?*]/.test(relative) || segments.some(segment =>
    !segment || segment === '.' || segment === '..' || /[. ]$/.test(segment) ||
    /^\.git$/i.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) {
    throw new Error(`Unsafe manifest path: ${JSON.stringify(relative)}`);
  }
  if (segments[0].toLowerCase() === lockName && relative !== lockName) {
    throw new Error(`Unsafe lock path: ${relative}`);
  }
}

function enumerate(root, relative = '', files = new Map()) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    validatePath(name);
    const full = path.join(root, name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw new Error(`Unsupported link or special file: ${name}`);
    }
    if (stat.isDirectory()) enumerate(root, name, files);
    else files.set(name, full);
  }
  if (!relative) {
    const names = new Map();
    for (const name of files.keys()) registerPath(names, name);
  }
  return files;
}

function readLock(text) {
  const metadata = new Map();
  const entries = new Map();
  const names = new Map();
  let body = false;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    if (line === '---' && !body) {
      body = true;
      continue;
    }
    if (!body) {
      const match = /^(tag|commit|url|synced_at)=(.+)$/.exec(line);
      if (!match || metadata.has(match[1])) throw new Error('Malformed sync lock metadata.');
      metadata.set(match[1], match[2]);
    } else {
      const match = /^([0-9a-fA-F]{64})  (.+)$/.exec(line);
      if (!match) throw new Error('Malformed sync lock manifest.');
      const [, hash, relative] = match;
      validatePath(relative);
      if (relative === lockName) continue;
      registerPath(names, relative);
      entries.set(relative, hash.toLowerCase());
    }
  }
  if (!body || !/^v\d+\.\d+\.\d+$/.test(metadata.get('tag') || '') ||
      !/^[0-9a-fA-F]{4,64}$/.test(metadata.get('commit') || '') ||
      !metadata.get('url') || !Number.isFinite(Date.parse(metadata.get('synced_at')))) {
    throw new Error('Malformed sync lock: required metadata or separator missing.');
  }
  return entries;
}

function pathKey(value) {
  if (process.platform === 'darwin') return value.normalize('NFC').toLowerCase().normalize('NFC');
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function registerPath(names, relative) {
  const segments = relative.split('/');
  for (let index = 0; index < segments.length; index++) {
    const original = segments.slice(0, index + 1).join('/');
    const key = pathKey(original);
    const file = index === segments.length - 1;
    const previous = names.get(key);
    if (previous && (previous.original !== original || previous.file || file)) {
      throw new Error(`Duplicate or filesystem-equivalent path: ${relative} conflicts with ${previous.original}`);
    }
    names.set(key, { original, file });
  }
}

function sameOrInside(candidate, target) {
  const canonical = pathKey(candidate);
  const boundary = pathKey(target);
  return canonical === boundary || canonical.startsWith(`${boundary}${path.sep}`);
}

function checkRegistration(root, target) {
  let directory = root;
  let repository;
  while (true) {
    const modules = path.join(directory, '.gitmodules');
    if (statIfPresent(modules)) {
      const stat = fs.lstatSync(modules);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe .gitmodules: ${modules}`);
      const records = git(['config', '--null', '--file', modules, '--get-regexp', '^submodule\\..*\\.path$'], root, true);
      for (const record of records.split('\0').filter(Boolean)) {
        const registered = path.resolve(directory, record.slice(record.indexOf('\n') + 1));
        if (sameOrInside(registered, target)) {
          throw new Error('Refusing a registered submodule target.');
        }
      }
    }
    if (!repository && statIfPresent(path.join(directory, '.git'))) repository = directory;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  if (repository) {
    const records = git(['-c', `core.worktree=${repository}`, '-c', 'core.bare=false', 'ls-files', '--stage', '-z'], repository);
    if (records.split('\0').some(record => record.startsWith('160000 ') &&
        sameOrInside(path.resolve(repository, record.slice(record.indexOf('\t') + 1)), target))) {
      throw new Error('Refusing a Git-index submodule target.');
    }
  }
}

function inspectTarget(root, target, options, warn = true) {
  checkRegistration(root, target);
  const stat = statIfPresent(target);
  if (!stat) return { stat: null, lock: null };
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Refusing a linked or non-directory target.');
  if (statIfPresent(path.join(target, '.git'))) throw new Error('Refusing a Git checkout target.');
  const files = enumerate(target);
  const lockFile = files.get(lockName);
  if (!lockFile) {
    if (fs.readdirSync(target).length || options.uninstall) throw new Error('Refusing an unmanaged target without a sync lock.');
    return { stat, lock: null };
  }
  const lock = fs.readFileSync(lockFile, 'utf8');
  const expected = readLock(lock);
  const equivalentFiles = new Map([...files].map(([relative, full]) => [pathKey(relative), full]));
  const modified = [];
  for (const [relative, hash] of expected) {
    const full = equivalentFiles.get(pathKey(relative));
    if (!full) {
      if (statIfPresent(path.join(target, relative))) throw new Error(`Tracked file is not an ordinary file: ${relative}`);
      if (warn) console.error(`[sync] Missing: ${relative}${options.uninstall ? '' : ' (will be restored)'}`);
    } else if (!options.uninstall && !options.force && sha256(full) !== hash &&
        !newlineEquivalent(root, full, hash)) {
      modified.push(relative);
    }
  }
  if (modified.length) throw new Error(`Local edits detected: ${modified.join(', ')}. Use --force to discard local edits.`);
  return { stat, lock };
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function newlineEquivalent(root, file, expected) {
  const bytes = fs.readFileSync(file);
  const text = bytes.toString('latin1');
  if (text.includes('\0') || /\r(?!\n)/.test(text)) return false;
  const crlf = text.includes('\r\n');
  if (crlf && /(?<!\r)\n/.test(text)) return false;
  const alternate = Buffer.from(crlf ? text.replaceAll('\r\n', '\n') : text.replaceAll('\n', '\r\n'), 'latin1');
  if (createHash('sha256').update(alternate).digest('hex') !== expected) return false;
  const relative = path.relative(root, file).split(path.sep).join('/');
  try {
    const records = git(['check-attr', '-z', 'text', 'eol', 'filter', 'working-tree-encoding', '--', relative], root).split('\0');
    const attributes = new Map();
    for (let index = 0; index + 2 < records.length; index += 3) attributes.set(records[index + 1], records[index + 2]);
    if (attributes.get('text') === 'unset' || ['filter', 'working-tree-encoding'].some(name =>
      !['unspecified', 'unset'].includes(attributes.get(name)))) return false;
    const eol = git(['ls-files', '--eol', '--cached', '--others', '-z', '--', relative], root);
    if (!eol.split('\0').some(record => /^i\/\S*\s+w\/(lf|crlf|mixed)\s/.test(record))) return false;
    if (attributes.get('text') === 'set' || attributes.get('text') === 'auto' ||
        ['lf', 'crlf'].includes(attributes.get('eol'))) return true;
    const autocrlf = git(['config', '--get', 'core.autocrlf'], root, true).trim().toLowerCase();
    return attributes.get('text') === 'unspecified' && ['true', 'input'].includes(autocrlf);
  } catch {
    return false;
  }
}

function acquire(root, tree, options) {
  const stagedGit = args => git(args, tree, false, tree);
  const tagRef = `refs/tags/${options.tag}`;
  const advertisement = git(['ls-remote', '--exit-code', '--refs', '--', options.repo, tagRef], root).trim();
  const advertised = advertisement.split('\t');
  if (advertised.length !== 2 || advertised[1] !== tagRef || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(advertised[0])) {
    throw new Error('Unsupported source object format or tag advertisement.');
  }
  const format = advertised[0].length === 64 ? 'sha256' : 'sha1';
  git(['init', '--quiet', `--object-format=${format}`, tree], root, false, tree);
  git(['fetch', '--quiet', '--depth', '1', '--no-tags', '--', options.repo, `${tagRef}:${tagRef}`], root, false, tree);
  const commit = stagedGit(['rev-parse', '--verify', `${tagRef}^{commit}`]).trim();
  const records = stagedGit(['ls-tree', '-r', '-z', commit]);
  const payload = [];
  const names = new Map();
  for (const record of records.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([0-9a-f]+)\t(.+)$/.exec(record);
    if (!match) throw new Error(`Unsupported source link or special entry: ${record}`);
    const [, mode, object, relative] = match;
    validatePath(relative);
    registerPath(names, relative);
    payload.push({ mode, object, relative });
  }
  for (const { mode, object, relative } of payload) {
    if (relative === lockName) continue;
    const full = path.join(tree, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const descriptor = fs.openSync(full, 'wx');
    try {
      git(['cat-file', 'blob', object], tree, false, tree, descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (process.platform !== 'win32') fs.chmodSync(full, mode === '100755' ? 0o755 : 0o644);
  }
  const shortCommit = stagedGit(['rev-parse', '--short', commit]).trim();
  fs.rmSync(path.join(tree, '.git'), { recursive: true, force: true });
  const files = new Map(payload.filter(({ relative }) => relative !== lockName)
    .map(({ relative }) => [relative, path.join(tree, relative)]));
  const manifest = [...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([relative, full]) => `${sha256(full)}  ${relative}`);
  fs.writeFileSync(path.join(tree, lockName), [
    '# .copilot-toolkit/.sync-lock - DO NOT EDIT (managed by install/sync.mjs)',
    `tag=${options.tag}`, `commit=${shortCommit}`, `url=${options.repo}`,
    `synced_at=${new Date().toISOString()}`, '---', ...manifest, '',
  ].join('\n'), 'utf8');
  return { shortCommit, count: files.size };
}

function run(options) {
  if (parseInt(process.versions.node.split('.')[0], 10) < 24) {
    throw new Error(`Node.js 24+ is required; found ${process.version}. Install a supported LTS release (recommended: Node 24 LTS): https://nodejs.org/`);
  }
  const root = fs.realpathSync(process.cwd());
  const target = path.join(root, mountName);
  const previous = inspectTarget(root, target, options);
  if (options.uninstall) {
    if (previous.stat) fs.rmSync(target, { recursive: true });
    console.log('[sync] Uninstall complete. Consumer configuration was not changed.');
    return;
  }
  const stage = fs.mkdtempSync(path.join(root, '.copilot-toolkit-sync-'));
  const tree = path.join(stage, 'tree');
  const backup = path.join(stage, 'backup');
  let retainedBackup = false;
  try {
    const result = acquire(root, tree, options);
    const current = inspectTarget(root, target, options, false);
    if (previous.stat?.dev !== current.stat?.dev || previous.stat?.ino !== current.stat?.ino || previous.lock !== current.lock) {
      throw new Error('Target changed during staging; refusing activation.');
    }
    if (current.stat) {
      fs.renameSync(target, backup);
      retainedBackup = true;
    }
    try {
      fs.renameSync(tree, target);
    } catch (activationError) {
      if (retainedBackup) {
        try {
          fs.renameSync(backup, target);
          retainedBackup = false;
        } catch (restoreError) {
          throw new Error(`Activation failed: ${activationError.message}. Restoration failed: ${restoreError.message}. Old tree retained at ${backup}`);
        }
      }
      throw new Error(`Activation failed: ${activationError.message}. ${current.stat ? 'Old tree restored.' : 'No prior installation was changed.'}`);
    }
    if (retainedBackup) {
      try {
        fs.rmSync(backup, { recursive: true });
        retainedBackup = false;
      } catch (error) {
        throw new Error(`New installation is active, but backup cleanup failed: ${error.message}. Backup remnants retained at ${backup}`);
      }
    }
    console.log(`[sync] Sync complete: ${options.tag} @ ${result.shortCommit}, ${result.count} files.`);
    console.log('[sync] Reload VS Code to pick up the toolkit. Consumer configuration was not changed.');
  } finally {
    if (!retainedBackup) {
      try {
        fs.rmSync(stage, { recursive: true, force: true });
      } catch (error) {
        console.error(`[sync] Staging cleanup failed: ${error.message}. Remnants retained at ${stage}`);
        process.exitCode = 1;
      }
    }
  }
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`[sync] ${error.message}\n${help}`);
  process.exitCode = 2;
}
if (options) {
  try {
    if (options.help) console.log(help);
    else run(options);
  } catch (error) {
    console.error(`[sync] ${error.message}`);
    process.exitCode = 1;
  }
}