#!/usr/bin/env node
// parse-git-remote.mjs -- generic git-remote identity parser for onboard-repo's
// generic-git provider (parseRepoUrl). Pure string parsing (no git / network), so it
// stays testable and carries no shell-quoting hazard. Handles the two remote forms a
// catch-all host can present: SSH (git@host:group/repo(.git)) and HTTPS
// (https://host/path.../repo(.git)). cloneUrl is echoed back VERBATIM so the submodule
// remote matches exactly what the user pasted.
//
// (The ado / github providers do their own host-specific parsing; this is only the
// fallback for hosts that derive-repo-context.mjs classifies as "unknown".)
//
// Usage:
//   node parse-git-remote.mjs "<git remote url>"
//
// stdout = one JSON object: { host, org, repoName, cloneUrl }
//   org = everything between host and repo (owner / group / nested subgroups); may be "".
// Exit codes: 0 ok | 1 unparseable / missing input.

function fail(message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

const input = process.argv[2];
if (!input || !input.trim()) fail('no git remote URL provided');
const raw = input.trim();

let host;
let path;
let m;
if ((m = raw.match(/^[\w.-]+@([\w.-]+):(.+?)\/?$/))) {
  // SSH: git@host:group/.../repo(.git)
  host = m[1];
  path = m[2];
} else if ((m = raw.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)\/?$/i))) {
  // HTTPS: https://[user@]host/path.../repo(.git)
  host = m[1];
  path = m[2];
} else {
  fail(`unrecognized git remote URL: ${raw}`);
}

path = path.replace(/\.git$/i, '');
const parts = path.split('/').filter(Boolean);
if (parts.length < 1) fail(`could not extract repo name from: ${raw}`);
const repoName = parts[parts.length - 1];
const org = parts.slice(0, -1).join('/');

process.stdout.write(`${JSON.stringify({ host, org, repoName, cloneUrl: raw })}\n`);
