import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeFiles, validateVendor, validatePackage, safePath, readBytes, writeBytes, hash, identity } from './runtime.mjs';

let parser;
async function yamlParser() {
  if (!parser) {
    validateVendor(fileURLToPath(new URL('../', import.meta.url)));
    parser = import('./vendor/js-yaml/dist/js-yaml.mjs');
  }
  return parser;
}

export async function parseMarkdown(bytes, { requireName = true } = {}) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw new Error('Markdown must be valid UTF-8');
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error('Missing YAML frontmatter');
  const yaml = await yamlParser();
  const metadata = yaml.load(match[1]);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || (requireName && (typeof metadata.name !== 'string' || !metadata.name.trim() || metadata.name.trim() !== metadata.name))) {
    throw new Error('YAML name must be a nonempty string');
  }
  return { metadata, body: text.slice(match[0].length), yaml };
}

export async function projectAgent(name, bytes) {
  const { metadata, body, yaml } = await parseMarkdown(bytes);
  if (metadata.name !== name || name === '_template') throw new Error('Invalid agent identity');
  if (name !== 'pr-quality-checker') return Buffer.from(bytes);
  delete metadata.model;
  return Buffer.from(`---\n${yaml.dump(metadata, { lineWidth: -1, noRefs: true })}---\n${body}`);
}

const aliases = new Map(['work', 'pr-review', 'onboard-repo', 'tool-dev'].map(name => [name, `${name}-internal`]));
const actionInput = 'Read the first token of the remaining invocation text as action; accept exactly create, update, or review.\n\n'
  + 'Before Step 0, toolkit resolution, workflow loading, todo creation, any tool call or side effect: if action is missing/invalid or name is missing/ambiguous, ask for the missing/corrected fields and stop. Do not choose defaults. An invocation with no arguments must ask for action and name without executing a workflow.\n\n'
  + 'Preserve the remaining request text verbatim after the action/name tokens, including spacing and quoted PR / WI / comment material, and retain all original attachments in user request text/context. Do not reinterpret that remainder as additional fields.\n\n'
  + 'Only after clarification is complete continue the original Input Resolution steps. Keep the Confirm Design Gate and consumer PR check-in rules unchanged; this input adaptation does not approve a design or activate PR execution.';
const nameInput = 'Read the next token as name; accept a single- or double-quoted name including spaces. If quoting is unmatched or the name/request boundary is ambiguous, ask for clarification rather than guessing.';

function projectBody(relative, body) {
  if (relative.startsWith('.github/prompts/')) {
    body = body.replace(/\.\.\/skills\/([a-z-]+)\//g, (_, name) => `../${aliases.get(name) ?? name}/`);
    for (const [name, alias] of aliases) body = body.replaceAll(`Invoke skill \`${name}\``, `Invoke skill \`${alias}\``);
  }
  if (relative === '.github/prompts/tool-dev.prompt.md') {
    body = body.replace('${input:action:create/update/review}', actionInput).replace('${input:name:tool name}', nameInput);
  }
  if (relative === '.github/skills/tool-dev/update-design-gate.md') {
    body = body.replace(/Inspect the \*\*user request text\*\* \(the freeform sentence after `\/tool-dev update <name>`,\r?\nplus any quoted PR \/ WI \/ comment the user attached\)\. This is NOT the `\$\{input:name\}` \/\r?\n`\$\{input:action\}` slot from the prompt frontmatter\./,
      'Inspect the **user request text** (the remaining invocation text after the parsed action\nand name, plus any quoted PR / WI / comment and original attachments). This is NOT the\nparsed `name` or `action` value from the invocation text.');
  }
  if (relative === '.github/prompts/tool-dev.prompt.md' || relative.startsWith('.github/skills/tool-dev/')) {
    body = body.replaceAll('${input:action}', 'action').replaceAll('${input:name}', 'name');
  }
  if (relative === '.github/skills/pr-review/steps/analyze.md') {
    body = body.replace('**7c: pr-quality-checker** (Haiku 4.5)', '**7c: pr-quality-checker** (inherits caller model)');
  }
  if (['.github/skills/work/SKILL.md', '.github/skills/pr-review/SKILL.md'].includes(relative)) {
    body = body.replace(/^\| Subagents \| (.+) \|\r?$/m, (_, row) => '| ACTIVE workspace agents | '
      + row.replace(/(\.github\/agents\/[a-z-]+)\.md/g, '$1.agent.md')
      + ' Relative to the candidate workspace; bare dispatch names are unchanged. |');
    body = body.replace(/- Subagents under `\{toolkit-root\}\/agents\/(work|pr)-\*\.md`[^\r\n]+/,
      (_, prefix) => `- Immutable source/reference agents: \`{toolkit-root}/agents/${prefix}-*.md\` retain the original references to \`{toolkit-root}/skills/${prefix === 'pr' ? 'pr-review' : 'work'}/...\` (where \`{toolkit-root}\` is the entry prompt's resolved toolkit path). These are not active definitions or dispatch targets. Active definitions are the candidate workspace files in the ACTIVE workspace agents index above. When maintaining source skill files, update the source agent path refs.`);
  }
  return body;
}

export async function generateCopilot(inputs) {
  const outputs = new Map();
  outputs.set('build/copilot/plugin/plugin.json', Buffer.from(`${JSON.stringify({ name: 'copilot-toolkit', version: '0.0.1', skills: ['./skills'] }, null, 2)}\n`));
  for (const relative of runtimeFiles) {
    const bytes = inputs.get(relative);
    const agent = /^\.github\/agents\/([^/]+)\.md$/.exec(relative);
    if (agent && agent[1] !== '_template') {
      outputs.set(`build/copilot/agents/${agent[1]}.agent.md`, await projectAgent(agent[1], bytes));
    }
    const prompt = /^\.github\/prompts\/([^/]+)\.prompt\.md$/.exec(relative);
    const skill = /^\.github\/skills\/([^/]+)\/(.+)$/.exec(relative);
    if (!prompt && !skill) continue;
    const name = prompt ? prompt[1] : (aliases.get(skill[1]) ?? skill[1]);
    const leaf = prompt ? 'SKILL.md' : skill[2];
    let output;
    if (prompt || leaf === 'SKILL.md' && aliases.has(skill[1])) {
      const { metadata, body, yaml } = await parseMarkdown(bytes, { requireName: !prompt });
      metadata.name = name;
      if (prompt) {
        if (!Object.hasOwn(metadata, 'user-invocable')) metadata['user-invocable'] = true;
        if (!Object.hasOwn(metadata, 'disable-model-invocation')) metadata['disable-model-invocation'] = true;
      }
      output = Buffer.from(`---\n${yaml.dump(metadata, { lineWidth: -1, noRefs: true })}---\n${projectBody(relative, body)}`);
    } else output = Buffer.from(projectBody(relative, bytes.toString('utf8')));
    outputs.set(`build/copilot/plugin/skills/${name}/${leaf}`, output);
  }
  return new Map([...outputs].sort(([left], [right]) => left < right ? -1 : 1));
}

export const ledgerPath = '.github/.copilot-toolkit/copilot-agents.json';
const agentDirectory = '.github/agents';

function exactPath(root, relative) {
  const target = safePath(root, relative);
  let directory = safePath(root);
  for (const part of relative.split('/')) {
    if (fs.existsSync(directory)) {
      const matches = fs.readdirSync(directory).filter(name => name.toLowerCase() === part.toLowerCase());
      if (matches.some(name => name !== part)) throw new Error(`Case collision: ${relative}`);
    }
    directory = path.join(directory, part);
  }
  return target;
}

function optionalBytes(root, relative) {
  return fs.existsSync(exactPath(root, relative)) ? readBytes(root, relative) : null;
}

function scanAgents(root) {
  const result = new Map();
  function visit(relative) {
    const target = exactPath(root, relative);
    if (!fs.existsSync(target)) return;
    if (!fs.lstatSync(target).isDirectory()) throw new Error(`Non-directory agent path: ${relative}`);
    for (const name of fs.readdirSync(target).sort()) {
      const child = `${relative}/${name}`;
      const location = exactPath(root, child);
      if (fs.lstatSync(location).isDirectory()) visit(child);
      else if (/\.agent\.md$/i.test(name)) result.set(child, readBytes(root, child));
    }
  }
  visit(agentDirectory);
  return result;
}

function equalBytes(left, right) {
  return left === null ? right === null : right !== null && left.equals(right);
}

function readLedger(bytes) {
  if (bytes === null) return { files: [] };
  const ledger = JSON.parse(bytes);
  if (ledger.version !== 1 || typeof ledger.packageIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(ledger.packageIdentity) || !Array.isArray(ledger.files)) {
    throw new Error('Invalid Copilot ownership ledger');
  }
  const paths = new Set();
  const names = new Set();
  for (const entry of ledger.files) {
    if (!entry || typeof entry.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(entry.name)
      || entry.path !== `${agentDirectory}/${entry.name}.agent.md` || typeof entry.installedHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.installedHash)
      || paths.has(entry.path.toLowerCase()) || names.has(entry.name.toLowerCase())) throw new Error('Invalid owned agent identity');
    paths.add(entry.path.toLowerCase());
    names.add(entry.name.toLowerCase());
  }
  return ledger;
}

export async function prepareCopilot({ consumerRoot, packageRoot, remove = false }) {
  const beforeLedger = optionalBytes(consumerRoot, ledgerPath);
  if (remove && beforeLedger === null) return null;
  const previous = readLedger(beforeLedger);
  const manifest = remove ? null : validatePackage(packageRoot);
  if (manifest && manifest.version !== 2) throw new Error('Copilot preparation requires provenance v2; rebuild the package');
  const beforeAgents = scanAgents(consumerRoot);
  const owned = new Map(previous.files.map(entry => [entry.path, entry]));
  const desired = new Map();
  if (manifest) {
    for (const entry of manifest.payload.filter(entry => entry.path.startsWith('build/copilot/agents/'))) {
      const bytes = readBytes(packageRoot, entry.path);
      const { metadata } = await parseMarkdown(bytes);
      const relative = `${agentDirectory}/${path.posix.basename(entry.path)}`;
      if (relative !== `${agentDirectory}/${metadata.name}.agent.md`) throw new Error('Projected agent identity mismatch');
      desired.set(relative, { bytes, name: metadata.name });
    }
  }
  const identities = new Map();
  for (const [relative, bytes] of beforeAgents) {
    const { metadata } = await parseMarkdown(bytes);
    const name = metadata.name.toLowerCase();
    if (identities.has(name)) throw new Error(`Duplicate YAML agent name: ${metadata.name}`);
    identities.set(name, relative);
    const entry = owned.get(relative);
    if (entry && (entry.installedHash !== hash(bytes) || entry.name !== metadata.name)) throw new Error(`Edited owned agent: ${relative}`);
  }
  for (const entry of previous.files) {
    if (!beforeAgents.has(entry.path)) throw new Error(`Missing owned agent: ${entry.path}`);
  }
  for (const [relative, entry] of desired) {
    exactPath(consumerRoot, relative);
    if (beforeAgents.has(relative) && !owned.has(relative)) throw new Error(`Unowned agent collision: ${relative}`);
    const conflict = identities.get(entry.name.toLowerCase());
    if (conflict && conflict !== relative) throw new Error(`YAML agent name collision: ${entry.name}`);
  }
  const files = [...desired].map(([relative, entry]) => ({ path: relative, name: entry.name, installedHash: hash(entry.bytes) }));
  const afterLedger = remove ? null : Buffer.from(`${JSON.stringify({ version: 1,
    packageIdentity: identity({ sourceCommit: manifest.sourceCommit, inputsHash: manifest.inputsHash, payloadHash: manifest.payloadHash }), files }, null, 2)}\n`);
  const changes = [...new Set([...owned.keys(), ...desired.keys()])].sort().map(relative => ({
    path: relative, before: beforeAgents.get(relative) ?? null, after: desired.get(relative)?.bytes ?? null,
  })).filter(change => !equalBytes(change.before, change.after));
  if (!equalBytes(beforeLedger, afterLedger)) changes.push({ path: ledgerPath, before: beforeLedger, after: afterLedger });
  const expectedAgents = new Map(beforeAgents);
  let expectedLedger = beforeLedger;
  function recheck() {
    const current = scanAgents(consumerRoot);
    if (current.size !== expectedAgents.size || [...expectedAgents].some(([relative, bytes]) => !equalBytes(bytes, current.get(relative) ?? null))
      || !equalBytes(expectedLedger, optionalBytes(consumerRoot, ledgerPath))) throw new Error('Concurrent agent or ledger change; no overwrite permitted');
  }
  recheck();
  const createdDirectories = [];
  const attempted = [];
  const lockPath = '.github/.copilot-toolkit/copilot-agents.lock';
  let locked = false;
  let backupRoot;
  function directories(relative) {
    let current = '';
    for (const part of path.posix.dirname(relative).split('/')) {
      current = current ? `${current}/${part}` : part;
      const target = exactPath(consumerRoot, current);
      if (!fs.existsSync(target)) {
        fs.mkdirSync(target);
        createdDirectories.push(current);
      }
    }
  }
  function replace(change, bytes, expected) {
    const check = () => {
      if (!equalBytes(expected, optionalBytes(consumerRoot, change.path))) throw new Error(`Concurrent change: ${change.path}`);
    };
    check();
    const target = exactPath(consumerRoot, change.path);
    if (bytes === null) {
      if (expected !== null) fs.unlinkSync(target);
      return;
    }
    directories(change.path);
    const scratch = fs.mkdtempSync(path.join(path.dirname(target), '.copilot-agent-'));
    const replacement = path.join(scratch, 'replacement');
    try {
      writeBytes(scratch, 'replacement', bytes);
      if (change.mode !== undefined) fs.chmodSync(replacement, change.mode);
      check();
      fs.renameSync(replacement, target);
    } finally {
      if (fs.existsSync(replacement)) fs.unlinkSync(replacement);
      fs.rmdirSync(scratch);
    }
  }
  return { changes, recheck,
    lock() {
      directories(lockPath);
      fs.mkdirSync(exactPath(consumerRoot, lockPath));
      locked = true;
      recheck();
    },
    backup(root) {
      backupRoot = root;
      for (const change of changes) {
        if (change.before !== null) {
          if (process.platform !== 'win32') change.mode = fs.statSync(exactPath(consumerRoot, change.path)).mode & 0o7777;
          writeBytes(root, `consumer/${change.path}`, change.before);
        }
      }
    },
    write(fault) {
      recheck();
      for (const change of changes) {
        const kind = change.path === ledgerPath ? 'ledger' : 'agent';
        fault(`${kind}-write`, change.path);
        recheck();
        attempted.push(change);
        replace(change, change.after, change.before);
        if (change.path === ledgerPath) expectedLedger = change.after;
        else if (change.after === null) expectedAgents.delete(change.path);
        else expectedAgents.set(change.path, change.after);
        fault(`${kind}-written`, change.path);
      }
      recheck();
    },
    restore(fault) {
      const failures = [];
      for (const change of attempted.toReversed()) {
        try {
          fault('projection-restore', change.path);
          const current = optionalBytes(consumerRoot, change.path);
          if (equalBytes(current, change.before)) continue;
          const backup = change.before === null ? null : readBytes(backupRoot, `consumer/${change.path}`);
          if (!equalBytes(backup, change.before)) throw new Error('Altered recovery backup');
          replace(change, backup, change.after);
        } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'Projection restoration failed');
    },
    release() {
      if (locked) fs.rmdirSync(exactPath(consumerRoot, lockPath));
      for (const relative of createdDirectories.toReversed()) {
        const target = exactPath(consumerRoot, relative);
        if (fs.existsSync(target) && !fs.readdirSync(target).length) fs.rmdirSync(target);
      }
    },
  };
}