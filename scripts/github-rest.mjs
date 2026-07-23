#!/usr/bin/env node
// github-rest.mjs -- deterministic GitHub helper for the pr-review GitHub provider.
//
// Replaces the hand-written `gh` / `Invoke-RestMethod` recipes in providers/github.md for the
// core PR operations. Prefers the authenticated `gh` CLI; falls back to REST + GITHUB_TOKEN when
// `gh` is unavailable. One fixed code path instead of improvising each call.
//
// Usage:
//   node github-rest.mjs <op> --owner <o> --repo <r> [--host github.com] --pr-id <id> [opts]
//
//   ops:
//     get-pr             -> --out (default raw-pr.json)   PR object (selected fields)
//     get-threads        -> --out (default raw-threads.json)  { issueComments, reviewComments }
//     get-diff           -> --out (default diff.txt)      unified PR patch (text)
//     post-comment       --body-file <p>                 top-level PR comment (Conversation tab, NOT resolvable); prints {url}
//     post-review-comment --body-file <p>                file-anchored review comment (RESOLVABLE thread); prints {url,resolvable}
//                         [--commit-id <sha>] [--path <file>] [--pr-file raw-pr.json] [--diff-file diff.txt]
//                         Anchors to the PR head commit + first changed file (subject_type=file). Falls back
//                         to a plain issue comment if the anchor cannot be resolved or the POST is rejected.
//
//   common opts: [--out <path>]
//
// Exit codes: 0 ok | 2 usage error | 3 auth (no gh and no GITHUB_TOKEN) | 4 call failed.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const PR_FIELDS = 'number,title,body,author,headRefName,baseRefName,headRefOid,state,isDraft,createdAt,reviewRequests,reviews,additions,deletions,changedFiles,closingIssuesReferences';

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

function tryExec(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 60000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...opts });
}

function ghAvailable() {
  try { tryExec('gh auth status', { timeout: 15000 }); return true; }
  catch { return false; }
}

function ghToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return tryExec('gh auth token').trim(); } catch { return ''; }
}

function apiBase(host) { return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`; }

async function ghFetch(url, init = {}) {
  const t = ghToken();
  if (!t) fail(3, 'no GitHub credential: set GITHUB_TOKEN or run `gh auth login`.');
  let res;
  try {
    res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...(init.headers || {}) } });
  } catch (e) { return fail(4, `network error calling GitHub: ${e.message}. URL: ${url}`); }
  const text = await res.text();
  if (!res.ok) return fail(4, `HTTP ${res.status} from GitHub. URL: ${url}\n${text.slice(0, 800)}`);
  try { return JSON.parse(text); } catch { return text; }
}

function output(obj, outPath, isText = false) {
  const data = isText ? String(obj) : `${JSON.stringify(obj, null, 2)}\n`;
  if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, data); console.error(`github-rest: wrote ${outPath}`); }
  else process.stdout.write(data.endsWith('\n') ? data : `${data}\n`);
}

function readJsonFile(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }

// First real file the PR patch touches (skip `+++ /dev/null` deletion hunks) -- the anchor for a file-level review comment.
function firstChangedFile(diffText) { const m = /^\+\+\+ b\/(.+)$/m.exec(diffText); return m ? m[1].trim() : ''; }

async function main() {
  const { op, opts } = parseArgs(process.argv.slice(2));
  if (!op || op === 'help' || opts.help) fail(op ? 0 : 2, 'ops: get-pr | get-threads | get-diff | post-comment | post-review-comment (see header for args)');

  const owner = opts.owner;
  const repo = opts.repo;
  const host = opts.host || 'github.com';
  const prId = opts['pr-id'];
  if (!owner || !repo) fail(2, `${op} needs --owner and --repo`);
  const repoFlag = host === 'github.com' ? `${owner}/${repo}` : `${host}/${owner}/${repo}`;
  const useGh = ghAvailable();
  const ghHostFlag = host === 'github.com' ? '' : `--hostname ${host} `;

  // Plain top-level PR comment (Conversation tab) -- NOT resolvable. Shared by `post-comment` and used as
  // the `post-review-comment` fallback so posting never silently fails when a resolvable anchor is unavailable.
  const postIssueComment = async (bodyFile) => {
    if (useGh) {
      const out = tryExec(`gh pr comment ${prId} --repo ${repoFlag} --body-file "${bodyFile}"`).trim();
      return { url: out.split(/\s+/).pop() || out };
    }
    const body = readFileSync(bodyFile, 'utf8');
    const r = await ghFetch(`${apiBase(host)}/repos/${owner}/${repo}/issues/${prId}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    return { id: r.id, url: r.html_url };
  };

  switch (op) {
    case 'get-pr': {
      if (!prId) fail(2, 'get-pr needs --pr-id');
      let pr;
      if (useGh) pr = JSON.parse(tryExec(`gh pr view ${prId} --repo ${repoFlag} --json ${PR_FIELDS}`));
      else pr = await ghFetch(`${apiBase(host)}/repos/${owner}/${repo}/pulls/${prId}`);
      output(pr, opts.out || 'raw-pr.json');
      return;
    }
    case 'get-threads': {
      if (!prId) fail(2, 'get-threads needs --pr-id');
      let issueComments;
      let reviewComments;
      if (useGh) {
        issueComments = JSON.parse(tryExec(`gh api ${ghHostFlag}repos/${owner}/${repo}/issues/${prId}/comments`));
        reviewComments = JSON.parse(tryExec(`gh api ${ghHostFlag}repos/${owner}/${repo}/pulls/${prId}/comments`));
      } else {
        issueComments = await ghFetch(`${apiBase(host)}/repos/${owner}/${repo}/issues/${prId}/comments`);
        reviewComments = await ghFetch(`${apiBase(host)}/repos/${owner}/${repo}/pulls/${prId}/comments`);
      }
      output({ issueComments, reviewComments }, opts.out || 'raw-threads.json');
      return;
    }
    case 'get-diff': {
      if (!prId) fail(2, 'get-diff needs --pr-id');
      let diff;
      if (useGh) diff = tryExec(`gh pr diff ${prId} --repo ${repoFlag}`);
      else diff = await ghFetch(`${apiBase(host)}/repos/${owner}/${repo}/pulls/${prId}`, { headers: { Accept: 'application/vnd.github.v3.diff' } });
      output(diff, opts.out || 'diff.txt', true);
      return;
    }
    case 'post-comment': {
      const bodyFile = opts['body-file'];
      if (!prId || !bodyFile) fail(2, 'post-comment needs --pr-id --body-file');
      output(await postIssueComment(bodyFile), opts.out);
      return;
    }
    case 'post-review-comment': {
      const bodyFile = opts['body-file'];
      if (!prId || !bodyFile) fail(2, 'post-review-comment needs --pr-id --body-file');
      // A file-level review comment (subject_type=file) is the ONLY GitHub comment surface that produces a
      // RESOLVABLE conversation thread. Anchor it to the PR head commit + the first changed file in the diff.
      let commitId = opts['commit-id'] || '';
      if (!commitId) {
        const pr = readJsonFile(opts['pr-file'] || 'raw-pr.json');
        commitId = (pr && (pr.headRefOid || pr.headSha)) || '';
      }
      let filePath = opts.path || '';
      if (!filePath) {
        const diffFile = opts['diff-file'] || 'diff.txt';
        if (existsSync(diffFile)) filePath = firstChangedFile(readFileSync(diffFile, 'utf8'));
      }
      // Never silently fail to post: if the anchor cannot be resolved, fall back to a (non-resolvable) issue comment.
      if (!commitId || !filePath) {
        const r = await postIssueComment(bodyFile);
        output({ ...r, resolvable: false, fellBackToIssueComment: true, reason: commitId ? 'no changed file resolved from diff' : 'no head commit resolved from --pr-file' }, opts.out);
        return;
      }
      try {
        let r;
        if (useGh) {
          r = JSON.parse(tryExec(`gh api ${ghHostFlag}repos/${owner}/${repo}/pulls/${prId}/comments -X POST -f commit_id=${commitId} -f path="${filePath}" -f subject_type=file -F body=@"${bodyFile}"`));
        } else {
          const body = readFileSync(bodyFile, 'utf8');
          r = await ghFetch(`${apiBase(host)}/repos/${owner}/${repo}/pulls/${prId}/comments`, { method: 'POST', body: JSON.stringify({ body, commit_id: commitId, path: filePath, subject_type: 'file' }) });
        }
        output({ id: r.id, url: r.html_url, resolvable: true, path: filePath }, opts.out);
      } catch (e) {
        // Anchor rejected (commit not part of the PR, path not in the diff, etc.) -> fall back to issue comment.
        const r = await postIssueComment(bodyFile);
        output({ ...r, resolvable: false, fellBackToIssueComment: true, reason: `review-comment POST failed: ${e.message}` }, opts.out);
      }
      return;
    }
    default:
      fail(2, `unknown op "${op}". One of: get-pr | get-threads | get-diff | post-comment | post-review-comment`);
  }
}

main().catch((e) => {
  if (e instanceof ExitError) { if (e.message) console.error(`github-rest: ${e.message}`); process.exitCode = e.code; }
  else { console.error(`github-rest: ${e.stack || e.message}`); process.exitCode = 1; }
});
