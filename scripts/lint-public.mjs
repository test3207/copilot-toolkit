#!/usr/bin/env node
// Scan files for private/business markers that must not appear in public toolkit content.
//
// Walks one or more paths (file or directory) and matches each line of every included file
// against the marker regex defined below.
//
// Markers flagged:
//   - msazure                       (ADO org)
//   - microsoft.visualstudio        (legacy ADO host)
//   - microsofticm                  (ICM host)
//   - microsoft/OS                  (Windows OS repo path)
//   - PR 7-8 digit numbers          (internal ADO PR IDs)
//   - !N (7-8 digits)               (ADO !PR shorthand)
//   - GUIDs (8-4-4-4-12 hex)        (subscription / tenant / resource IDs)
//   - @microsoft.com                (corp email domain)
//   - .kusto.windows.net            (internal kusto cluster host)
//   - .kusto.net                    (internal kusto cluster host, short form)
//
// Documented-public allowlist:
//   Values that MATCH the regex but are explicitly public (in Microsoft's published docs) are
//   exempted via --allow-value (one entry per value, case-insensitive). The default allowlist
//   carries the publicly documented ADO REST API resource GUID (Azure DevOps OAuth scope ID, see
//   learn.microsoft.com). Do NOT add ANYTHING else without an MS-public-docs URL in the same
//   commit.
//
// Usage:
//   node scripts/lint-public.mjs --path .github,scripts,templates,install,INSTALL.md,README.md
//   node scripts/lint-public.mjs --path dist --exclude "*private*"
//
// Options:
//   --path <a,b,c>          files or directories to scan; directories are walked recursively.
//                           Repeatable. Default '.'.
//   --extension <.a,.b>     file extensions to include. Repeatable. Default: markdown, scripts,
//                           config text.
//   --exclude <glob>        glob matched against the full path (* and ? only, case-insensitive;
//                           PowerShell's [abc] classes are not supported). Repeatable.
//   --allow-value <value>   literal matched-string value to exempt (case-insensitive string
//                           equality, NOT regex). Repeatable.
//   --include-self          by default this script auto-excludes its own file, because the marker
//                           regex literal triggers every marker on itself. Pass this to scan it
//                           anyway (e.g. when verifying the regex).
//
// Output format: <file>:<line>: <matched-text>
// Exit code:     0 = clean, 1 = at least one match, 2 = bad usage.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FLAGS = new Set(['--path', '--extension', '--exclude', '--allow-value', '--include-self']);
const VALUELESS = new Set(['--include-self']);

function usage(message) {
  console.error(`lint-public: ${message}`);
  process.exit(2);
}

// A leak gate must fail closed on a usage error: a typo that silently fell back to the default
// scope would report clean over the wrong tree.
function args(flag, def) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] !== flag) continue;
    const value = process.argv[i + 1];
    if (!value || value.startsWith('--')) usage(`${flag} requires a value.`);
    out.push(...value.split(',').filter(Boolean));
  }
  return out.length ? out : def;
}

for (let i = 2; i < process.argv.length; i++) {
  const token = process.argv[i];
  if (!token.startsWith('--')) {
    usage(`unexpected argument "${token}". Lists are comma-separated: --path a,b,c`);
  }
  if (!FLAGS.has(token)) usage(`unknown option "${token}". Known options: ${[...FLAGS].join(', ')}.`);
  if (!VALUELESS.has(token)) i++;
}

const paths = args('--path', ['.']);
const extensions = args('--extension', [
  '.md', '.ps1', '.psm1', '.sh', '.mjs', '.cjs', '.js', '.ts', '.json', '.jsonc', '.yml', '.yaml', '.txt',
]).map((e) => e.toLowerCase());
const excludes = args('--exclude', []);
const allowValues = args('--allow-value', []);
const includeSelf = process.argv.includes('--include-self');

// Publicly documented values that match the regex but are EXPLICITLY public.
// Do NOT extend without an MS-public-docs URL pinned in the calling commit.
const allowlist = new Set(
  ['499b84ac-1321-427f-aa17-267ca6975798', ...allowValues].map((v) => v.toLowerCase())
);

// Single combined regex; case-insensitive at match time.
// Boundaries chosen so 'msazure' inside a longer identifier (e.g. 'msazure-cdn') still hits;
// bare 7-8 digit PR numbers require \b to avoid catching commit SHAs.
const pattern = [
  'msazure',
  'microsoft\\.visualstudio',
  'microsofticm',
  'microsoft/OS',
  '\\bPR\\s+\\d{7,8}\\b',
  '![0-9]{7,8}\\b',
  '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',
  '@microsoft\\.com',
  '\\.kusto\\.windows\\.net',
  '\\.kusto\\.net',
].join('|');
const regex = new RegExp(pattern, 'gi');

const selfPath = path.resolve(fileURLToPath(import.meta.url));

// PowerShell -like also supported [abc] character classes; this supports * and ? only, which is
// what the usage above documents and what every in-repo invocation uses.
const excludeRegexes = excludes.map(
  (g) =>
    new RegExp(
      '^' + g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*').replace(/\\\?/g, '.') + '$',
      'i'
    )
);

function shouldExclude(fullPath) {
  if (!includeSelf && fullPath.toLowerCase() === selfPath.toLowerCase()) return true;
  return excludeRegexes.some((r) => r.test(fullPath));
}

function isRegularFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

const files = [];
// PowerShell skipped .git because Get-ChildItem ignores the Windows hidden attribute, which git
// sets on that directory. Node has no portable way to read that attribute, and skipping every
// dot-name instead would silently drop .github -- a false negative in a leak gate. Name the
// never-shipped directory instead.
const skipDirs = new Set(['.git']);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  // Files before subdirectories, matching Get-ChildItem -Recurse -File's ordering.
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) continue;
    if (!extensions.includes(path.extname(entry.name).toLowerCase()) || shouldExclude(full)) continue;
    // Get-ChildItem -File enumerated regular files only. Reading a FIFO would block the gate
    // forever, and a symlink has to be resolved before its target can be classified.
    if (!isRegularFile(full)) continue;
    files.push(full);
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !skipDirs.has(entry.name)) walk(path.join(dir, entry.name));
  }
}

for (const p of paths) {
  if (!fs.existsSync(p)) {
    console.error(`Path not found: ${p}`);
    process.exit(2);
  }
  const full = path.resolve(p);
  if (fs.statSync(full).isDirectory()) walk(full);
  else if (!shouldExclude(full)) files.push(full);
}

// .NET's StreamReader detected the byte-order mark, so the PowerShell gate read UTF-16 and UTF-32
// files as text. Decoding those as UTF-8 yields NUL-separated characters that no marker can match,
// which would make the gate silently pass a file containing a leak.
// UTF-32 LE must be tested before UTF-16 LE: its BOM starts with the same two bytes.
function decodeUtf32(buf, littleEndian) {
  const units = Math.floor(buf.length / 4);
  let out = '';
  for (let i = 0; i < units; i++) {
    const cp = littleEndian ? buf.readUInt32LE(i * 4) : buf.readUInt32BE(i * 4);
    out += cp <= 0x10ffff ? String.fromCodePoint(cp) : '\uFFFD';
  }
  return out;
}

function readText(file) {
  const buf = fs.readFileSync(file);
  const b = (n) => buf[n];
  if (buf.length >= 4 && b(0) === 0xff && b(1) === 0xfe && b(2) === 0x00 && b(3) === 0x00) {
    return decodeUtf32(buf.subarray(4), true);
  }
  if (buf.length >= 4 && b(0) === 0x00 && b(1) === 0x00 && b(2) === 0xfe && b(3) === 0xff) {
    return decodeUtf32(buf.subarray(4), false);
  }
  if (buf.length >= 2 && b(0) === 0xff && b(1) === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && b(0) === 0xfe && b(1) === 0xff) {
    // swap16 mutates in place and rejects an odd length, so copy and drop a trailing stray byte.
    const body = Buffer.from(buf.subarray(2, buf.length - ((buf.length - 2) % 2)));
    return body.swap16().toString('utf16le');
  }
  if (buf.length >= 3 && b(0) === 0xef && b(1) === 0xbb && b(2) === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  return buf.toString('utf8');
}

let matchCount = 0;
for (const file of files) {
  // File.ReadLines treats a lone CR as a line break too; /\r?\n/ would fold a CR-only file into
  // one line and report every hit at line 1.
  const lines = readText(file).split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(regex)) {
      if (allowlist.has(m[0].toLowerCase())) continue;
      console.log(`${file}:${i + 1}: ${m[0]}`);
      matchCount++;
    }
  }
}

process.exitCode = matchCount > 0 ? 1 : 0;
