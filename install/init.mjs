import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { activateRuntime, validatePackage, validateActiveRuntime, validateVendor, safePath, readBytes, writeBytes } from './runtime.mjs';

export const toolkitMount = fileURLToPath(new URL('../', import.meta.url));
const locations = {
  'chat.agentSkillsLocations': 'skills',
  'chat.agentFilesLocations': 'agents',
  'chat.promptFilesLocations': 'prompts',
};

export function prepareSettings(consumerRoot, mount) {
  validateVendor(toolkitMount);
  const { parseTree, findNodeAtLocation, modify, applyEdits, createScanner, SyntaxKind } = createRequire(import.meta.url)('./vendor/jsonc-parser');
  consumerRoot = fs.realpathSync.native(safePath(consumerRoot));
  mount = fs.realpathSync.native(safePath(mount));
  const mountRelative = path.relative(consumerRoot, mount).split(path.sep).join('/');
  if (mountRelative === '..' || mountRelative.startsWith('../') || path.isAbsolute(mountRelative)) throw new Error('Toolkit mount must be inside the consumer root');
  const selfHosted = mountRelative === '';
  const mountName = process.platform === 'win32' ? mountRelative.toLowerCase() : mountRelative;
  if (!selfHosted && mountName !== '.copilot-toolkit') throw new Error('Toolkit mount must be the consumer root itself or its direct .copilot-toolkit child');
  const target = safePath(consumerRoot, '.vscode/settings.json');
  const directoryExisted = fs.existsSync(path.dirname(target));
  const before = fs.existsSync(target) ? readBytes(consumerRoot, '.vscode/settings.json') : null;
  const mode = before !== null && process.platform !== 'win32' ? fs.statSync(target).mode & 0o7777 : null;
  const original = before?.toString('utf8') ?? '{}\n';
  if (before && !Buffer.from(original).equals(before)) throw new Error('Settings must be valid UTF-8');
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  let text = original.slice(bom.length);
  const errors = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true });
  if (errors.length || tree?.type !== 'object') throw new Error('Malformed JSONC settings; no changes made');
  function properties(node) {
    const result = new Map();
    for (const property of node.children ?? []) {
      const name = property.children[0].value;
      if (result.has(name)) throw new Error('Duplicate settings key; ownership is ambiguous');
      result.set(name, property.children[1]);
    }
    return result;
  }
  const rootProperties = properties(tree);
  const prefix = mountRelative ? `${mountRelative}/` : '';
  function edit(location, value) {
    text = applyEdits(text, modify(text, location, value, {}));
  }
  function migrate(key, entry, built) {
    const currentTree = parseTree(text);
    const property = findNodeAtLocation(currentTree, [key, entry]).parent;
    if (!findNodeAtLocation(currentTree, [key, built])) {
      const token = property.children[0];
      text = applyEdits(text, [{ offset: token.offset, length: token.length, content: JSON.stringify(built) }]);
      return;
    }
    const scanner = createScanner(text, true);
    const edits = [];
    const end = property.offset + property.length;
    scanner.setPosition(property.offset);
    while (scanner.scan() !== SyntaxKind.EOF && scanner.getTokenOffset() < end) {
      edits.push({ offset: scanner.getTokenOffset(), length: scanner.getTokenLength(), content: '' });
    }
    scanner.setPosition(end);
    if (scanner.scan() !== SyntaxKind.CommaToken) {
      const siblings = property.parent.children;
      const previous = siblings[siblings.indexOf(property) - 1];
      if (previous) {
        scanner.setPosition(previous.offset + previous.length);
        scanner.scan();
      }
    }
    if (scanner.getToken() === SyntaxKind.CommaToken) {
      edits.push({ offset: scanner.getTokenOffset(), length: scanner.getTokenLength(), content: '' });
    }
    text = applyEdits(text, edits);
  }
  for (const [key, directory] of Object.entries(locations)) {
    const node = rootProperties.get(key);
    if (node && node.type !== 'object') throw new Error('Discovery locations must be maps; no changes made');
    const entries = node ? properties(node) : new Map();
    const source = `${prefix}.github/${directory}`;
    const built = `${prefix}build/.github/${directory}`;
    const owned = [];
    for (const [entry, value] of entries) {
      const resolved = path.resolve(consumerRoot, entry.replaceAll('\\', '/'));
      const matches = [source, built].filter(relative => process.platform === 'win32'
        ? resolved.toLowerCase() === path.resolve(consumerRoot, relative).toLowerCase()
        : resolved === path.resolve(consumerRoot, relative));
      if (matches.length) {
        if (value.type !== 'boolean') throw new Error('Toolkit discovery value must be boolean');
        owned.push({ entry, value: value.value, built: matches[0] === built });
      }
    }
    const builtEntries = owned.filter(entry => entry.built);
    const considered = selfHosted && builtEntries.length ? builtEntries : owned;
    if (new Set(considered.map(entry => entry.value)).size > 1) throw new Error('Conflicting toolkit discovery entries; ownership is ambiguous');
    const enabled = considered[0]?.value ?? true;
    for (const entry of owned) {
      if (entry.entry !== built && !(selfHosted && entry.entry === source)) migrate(key, entry.entry, built);
    }
    if (selfHosted) edit([key, source], false);
    const current = findNodeAtLocation(parseTree(text), [key, built]);
    if (current?.value !== enabled) edit([key, built], enabled);
  }
  const after = Buffer.from(bom + text);
  function replace(bytes) {
    safePath(consumerRoot, '.vscode/settings.json');
    if (fs.existsSync(target)) readBytes(consumerRoot, '.vscode/settings.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const scratch = fs.mkdtempSync(path.join(path.dirname(target), '.settings-'));
    try {
      const replacement = path.join(scratch, 'settings.json');
      if (mode === null) writeBytes(scratch, 'settings.json', bytes);
      else {
        fs.writeFileSync(replacement, bytes, { flag: 'wx', mode });
        fs.chmodSync(replacement, mode);
      }
      fs.renameSync(replacement, target);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
  return {
    before, after,
    write() { if (!before?.equals(after)) replace(after); },
    restore() {
      if (before !== null) replace(before);
      else {
        fs.rmSync(safePath(consumerRoot, '.vscode/settings.json'), { force: true });
        if (!directoryExisted && fs.existsSync(path.dirname(target)) && !fs.readdirSync(path.dirname(target)).length) fs.rmdirSync(path.dirname(target));
      }
    },
  };
}

function executable(name) {
  const names = process.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`] : [name];
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const filename of names) {
      const full = path.join(directory, filename);
      try {
        if (fs.statSync(full).size > 0) return full;
      } catch {}
    }
  }
  return null;
}

export function diagnostics({ probe = spawnSync } = {}) {
  const warnings = [];
  const tools = [{ name: 'node', path: process.execPath, version: process.version }];
  const deadline = Date.now() + 15000;
  function run(full, args) {
    if (Date.now() >= deadline) return null;
    let command = full;
    let argumentsList = args;
    if (process.platform === 'win32' && full.endsWith('.cmd')) {
      command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/cmd.exe');
      if (/["%!\r\n]/.test(full)) return null;
      argumentsList = ['/d', '/s', '/c', `""${full}" ${args.join(' ')}"`];
    }
    const result = probe(command, argumentsList, { timeout: Math.max(1, Math.min(2500, deadline - Date.now())),
      encoding: 'utf8', maxBuffer: 65536, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', AZURE_CORE_ONLY_SHOW_ERRORS: 'true' } });
    return !result.error && result.status === 0 ? result.stdout : null;
  }
  for (const name of ['git', process.platform === 'win32' ? 'pwsh' : 'sh', 'gh', 'az']) {
    const full = executable(name);
    if (!full) {
      warnings.push(`${name} unavailable on PATH; configure it before workflows that require it.`);
      continue;
    }
    const version = run(full, name === 'sh' ? ['-c', 'exit 0'] : ['--version']);
    tools.push({ name, path: full, version: version?.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? 'unverified' });
    if (version === null) warnings.push(`${name} version probe failed or exceeded the diagnostic budget.`);
    if (name === 'git' && version !== null) {
      const parts = version.match(/(\d+)\.(\d+)/);
      if (!parts || Number(parts[1]) < 2 || (Number(parts[1]) === 2 && Number(parts[2]) < 29)) warnings.push('Sync requires Git 2.29 or newer.');
    }
    if (name === 'gh' && run(full, ['auth', 'status']) === null) warnings.push('GitHub authentication unavailable or unverified; check gh auth status before GitHub tasks.');
    if (name === 'az' && run(full, ['account', 'show', '--output', 'none']) === null) warnings.push('Azure authentication unavailable or unverified; check az account show before Azure tasks.');
  }
  if (['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy'].some(key => process.env[key])) {
    warnings.push('Proxy configuration detected; verify reachability for the selected workflow endpoint. Proxy values are not displayed.');
  }
  warnings.push('Endpoint network access is workflow-specific and was not probed; run the selected workflow preflight before remote operations.');
  return { tools, warnings, budgetMs: 15000 };
}

export async function initialize({ mount = toolkitMount, consumerRoot = process.cwd(), build = false, fault = () => {}, diagnose = diagnostics } = {}) {
  mount = safePath(mount);
  let previous;
  try { previous = validateActiveRuntime(mount); } catch {}
  let candidate;
  try {
    consumerRoot = safePath(consumerRoot);
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or newer is required');
    if (!build) validatePackage(mount);
    const settings = prepareSettings(consumerRoot, mount);
    if (build) {
      const builder = safePath(mount, 'scripts/build.mjs');
      const { stageBuild } = await import(pathToFileURL(builder).href);
      candidate = await stageBuild({ sourceRoot: mount, stagingParent: mount, fault });
    }
    activateRuntime({ mount, candidate: candidate?.root, settings, fault });
    const manifest = validatePackage(mount);
    let environment;
    try { environment = diagnose(); } catch { environment = { tools: [], warnings: ['Environment diagnostics failed; verify workflow prerequisites manually.'] }; }
    return { ready: true, sourceCommit: manifest.sourceCommit, inputIdentity: manifest.inputsHash,
      dirty: manifest.dirty, runtime: path.join(mount, 'build'), ...environment };
  } catch (error) {
    error.previousRuntimeAvailable = false;
    try {
      const current = validateActiveRuntime(mount);
      error.previousRuntimeAvailable = Boolean(previous && current.inputsHash === previous.inputsHash && current.payloadHash === previous.payloadHash);
    } catch {}
    throw error;
  } finally {
    if (candidate) fs.rmSync(candidate.root, { recursive: true, force: true });
  }
}

function argumentsFor(values) {
  const options = {};
  const seen = new Set();
  for (let index = 0; index < values.length; index++) {
    const flag = values[index];
    if (seen.has(flag)) throw new Error('Repeated option');
    seen.add(flag);
    if (flag === '--build') options.build = true;
    else if (flag === '--consumer-root' && values[index + 1] && !values[index + 1].startsWith('--')) options.consumerRoot = path.resolve(values[++index]);
    else throw new Error('Unknown option or missing argument');
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let options;
  try {
    options = argumentsFor(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}. Usage: node install/init.mjs [--build] [--consumer-root <path>]`);
    process.exitCode = 2;
  }
  if (options) {
    try {
      console.log(JSON.stringify(await initialize(options), null, 2));
      console.log('Ready. Reload VS Code and verify built discovery; consumer instructions were not changed.');
    } catch (error) {
      console.error(`Init failed; this attempt is not ready. Previous runtime available: ${error.previousRuntimeAvailable ?? 'unknown'}. ${error.message}`);
      process.exitCode = 1;
    }
  }
}