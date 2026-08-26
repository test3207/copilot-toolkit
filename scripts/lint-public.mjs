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
//   node scripts/lint-public.mjs --path dist --exclude "*examples/private/*"
//
// Options:
//   --path <a,b,c>          files or directories to scan; directories are walked recursively.
//                           Repeatable. Default '.'.
//   --extension <.a,.b>     file extensions to include. Repeatable. Default: markdown, scripts,
//                           config text.
//   --exclude <glob>        glob matched against the full path (* and ? only, case-insensitive).
//                           Repeatable.
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

function args(flag, def) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1]) {
      out.push(...process.argv[i + 1].split(',').filter(Boolean));
    }
  }
  return out.length ? out : def;
}

const paths = args('--path', ['.']);
const extensions = args('--extension', [
  '.md', '.ps1', '.psm1', '.mjs', '.cjs', '.js', '.ts', '.json', '.jsonc', '.yml', '.yaml', '.txt',
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

// PowerShell -like semantics, restricted to the wildcards this gate documents.
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

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (extensions.includes(path.extname(entry.name).toLowerCase()) && !shouldExclude(full)) {
      files.push(full);
    }
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

let matchCount = 0;
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(regex)) {
      if (allowlist.has(m[0].toLowerCase())) continue;
      console.log(`${file}:${i + 1}: ${m[0]}`);
      matchCount++;
    }
  }
}

process.exitCode = matchCount > 0 ? 1 : 0;
