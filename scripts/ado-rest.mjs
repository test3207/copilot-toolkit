#!/usr/bin/env node
// ado-rest.mjs -- deterministic Azure DevOps REST helper for the pr-review `rest` transport.
//
// Replaces the hand-written `Invoke-RestMethod` recipes in providers/ado.md for the core PR
// operations, so the agent calls one fixed, tested code path instead of improvising each call
// (right URL / api-version / escaping / payload shape every time). The MCP path used in
// registry mode is unchanged -- this only backs the `rest` transport.
//
// Auth: an ADO bearer token from `az account get-access-token --resource <resourceGuid>`
// (well-known public ADO resource GUID by default; override for sovereign clouds).
//
// Usage:
//   node ado-rest.mjs <op> --org <o> --project <p> --repo-guid <g> --pr-id <id> [opts]
//
//   ops:
//     get-repo      --org --project --repo-name                       -> {id,name,defaultBranch}
//     get-pr        --org --project --repo-guid --pr-id               -> --out (default raw-pr.json)
//     get-threads   --org --project --repo-guid --pr-id               -> --out (default raw-threads.json)
//     post-comment  --org --project --repo-guid --pr-id --body-file <p> -> {threadId,...}
//
//   common opts: [--resource-guid <g>] [--out <path>] [--api-version 7.1]
//
// Exit codes: 0 ok | 2 usage error | 3 auth (no az token) | 4 HTTP non-2xx / non-JSON.
// Without --out, JSON goes to stdout; with --out it is written to the file (path logged to stderr).

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798'; // public ADO
const DEFAULT_API = '7.1';

function parseArgs(argv) {
  const op = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
  const opts = {};
  for (let i = op ? 1 : 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { opts[key] = next; i++; }
    else opts[key] = 'true';
  }
  return { op, opts };
}

class ExitError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
// Signal an exit WITHOUT process.exit(): a hard exit while undici's keep-alive socket is mid
// teardown trips a libuv assertion on Windows. Throw instead; the top-level catch sets exitCode.
function fail(code, msg) { throw new ExitError(code, msg); }

function getToken(resourceGuid) {
  if (!/^[0-9a-fA-F-]{36}$/.test(resourceGuid)) fail(2, `--resource-guid must be a GUID, got "${resourceGuid}"`);
  try {
    const out = execSync(
      `az account get-access-token --resource ${resourceGuid} --query accessToken -o tsv`,
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000, windowsHide: true },
    ).trim();
    if (!out) throw new Error('empty token');
    return out;
  } catch (e) {
    return fail(3, `could not get an ADO token via az (resource ${resourceGuid}). Run \`az login\`. ${(e.stderr || e.message || '').toString().trim()}`);
  }
}

async function adoFetch(url, token, init = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  } catch (e) {
    return fail(4, `network error calling ADO: ${e.message}. URL: ${url}`);
  }
  const text = await res.text();
  if (res.status === 203) {
    return fail(4, `HTTP 203 (Non-Authoritative) -- the az token is authenticated but NOT authorized for org "${new URL(url).host}". Re-run \`az login --tenant <id>\` for that org's tenant. URL: ${url}`);
  }
  if (!res.ok) return fail(4, `HTTP ${res.status} from ADO. URL: ${url}\n${text.slice(0, 800)}`);
  try { return JSON.parse(text); }
  catch { return fail(4, `ADO returned non-JSON (status ${res.status}) -- usually a sign-in redirect stub == token not authorized for this org. URL: ${url}`); }
}

function output(obj, outPath) {
  const json = `${JSON.stringify(obj, null, 2)}\n`;
  if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, json); console.error(`ado-rest: wrote ${outPath}`); }
  else process.stdout.write(json);
}

async function main() {
  const { op, opts } = parseArgs(process.argv.slice(2));
  if (!op || op === 'help' || opts.help) {
    fail(op ? 0 : 2, 'ops: get-repo | get-pr | get-threads | post-comment (see header for args)');
  }
  const org = opts.org;
  const project = opts.project;
  const repoGuid = opts['repo-guid'];
  const prId = opts['pr-id'];
  const api = opts['api-version'] || DEFAULT_API;
  if (!org || !project) fail(2, `${op} needs --org and --project`);
  const reposBase = `https://${org}.visualstudio.com/${encodeURIComponent(project)}/_apis/git/repositories`;
  const token = getToken(opts['resource-guid'] || DEFAULT_RESOURCE);

  switch (op) {
    case 'get-repo': {
      const repoName = opts['repo-name'];
      if (!repoName) fail(2, 'get-repo needs --repo-name');
      const r = await adoFetch(`${reposBase}/${encodeURIComponent(repoName)}?api-version=${api}`, token);
      output({ id: r.id, name: r.name, defaultBranch: r.defaultBranch }, opts.out);
      return;
    }
    case 'get-pr': {
      if (!repoGuid || !prId) fail(2, 'get-pr needs --repo-guid --pr-id');
      const r = await adoFetch(`${reposBase}/${repoGuid}/pullRequests/${prId}?includeWorkItemRefs=true&api-version=${api}`, token);
      output(r, opts.out || 'raw-pr.json');
      return;
    }
    case 'get-threads': {
      if (!repoGuid || !prId) fail(2, 'get-threads needs --repo-guid --pr-id');
      const r = await adoFetch(`${reposBase}/${repoGuid}/pullRequests/${prId}/threads?api-version=${api}`, token);
      output(Array.isArray(r.value) ? r.value : r, opts.out || 'raw-threads.json');
      return;
    }
    case 'post-comment': {
      const bodyFile = opts['body-file'];
      if (!repoGuid || !prId || !bodyFile) fail(2, 'post-comment needs --repo-guid --pr-id --body-file');
      const content = readFileSync(bodyFile, 'utf8');
      const payload = { comments: [{ parentCommentId: 0, content, commentType: 1 }], status: 1 };
      const r = await adoFetch(`${reposBase}/${repoGuid}/pullRequests/${prId}/threads?api-version=${api}`, token, { method: 'POST', body: JSON.stringify(payload) });
      output({ threadId: r.id, status: r.status, commentId: r.comments?.[0]?.id ?? null }, opts.out);
      return;
    }
    default:
      fail(2, `unknown op "${op}". One of: get-repo | get-pr | get-threads | post-comment`);
  }
}

main().catch((e) => {
  if (e instanceof ExitError) { if (e.message) console.error(`ado-rest: ${e.message}`); process.exitCode = e.code; }
  else { console.error(`ado-rest: ${e.stack || e.message}`); process.exitCode = 1; }
});
