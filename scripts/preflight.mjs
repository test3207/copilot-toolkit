#!/usr/bin/env node
// preflight.mjs -- environment + credential doctor for pr-review.
//
// Probes the real dependencies (node, git, and the platform's auth CLI) and prints a JSON
// capability report + actionable remediation. Workflow Step 0 consumes this to pick an access
// method (mcp | rest | cli) and to tell the user exactly what to install / sign into when
// something is missing. There is no offline mode -- a missing platform credential is blocking.
//
// Usage:
//   node preflight.mjs --platform ado|github [--mcp-configured true|false]
//
// stdout = one JSON object. Exit code: 0 = all required deps present,
// 2 = a required dependency (node / git / the platform credential az or gh) is missing
//     -> the caller must STOP and show remediation.

import { execSync } from 'node:child_process';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const platform = (arg('--platform', 'ado') || 'ado').toLowerCase();
const mcpConfigured = arg('--mcp-configured', 'false') === 'true';

// Run a FIXED command (constant -- no user input, so shell use is safe). Returns
// { ok, out } where ok=false means the binary is missing or the command failed.
function run(cmd) {
  try {
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, windowsHide: true, encoding: 'utf8' });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: (e.stdout || '').toString().trim(), err: (e.stderr || e.message || '').toString().trim() };
  }
}

const HINTS = {
  node: { install: 'Install Node.js 24+, using a supported LTS release (recommended: Node 24 LTS): https://nodejs.org/ (winget: winget install OpenJS.NodeJS.LTS)' },
  git: { install: 'Install Git: https://git-scm.com/downloads (winget: winget install Git.Git)' },
  az: {
    install: 'Install Azure CLI: https://aka.ms/installazurecliwindows (winget: winget install Microsoft.AzureCLI)',
    auth: 'Sign in: az login   (cross-tenant: az login --tenant <tenantId>)',
  },
  gh: {
    install: 'Install GitHub CLI: https://cli.github.com/ (winget: winget install GitHub.cli)',
    auth: 'Sign in: gh auth login',
  },
};

const deps = {};
const blocking = [];     // hard-missing deps that must STOP the run
const remediation = [];  // actionable items for missing / unauthenticated capabilities

// node -- we are running under it
{
  const major = parseInt(process.versions.node.split('.')[0], 10);
  deps.node = { present: true, version: process.version, ok: major >= 24 };
  if (!deps.node.ok) {
    blocking.push('node');
    remediation.push({ dep: 'node', why: `Node ${process.version} is too old (need >= 24).`, fix: HINTS.node.install });
  }
}

// git -- always required (checkout + diff the PR branch)
{
  const g = run('git --version');
  deps.git = { present: g.ok, ok: g.ok, version: g.ok ? g.out : null };
  if (!g.ok) {
    blocking.push('git');
    remediation.push({ dep: 'git', why: 'git is required to checkout and diff the PR branch.', fix: HINTS.git.install });
  }
}

if (platform === 'ado') {
  const azv = run('az version');
  if (!azv.ok) {
    deps.az = { present: false, signedIn: false };
    blocking.push('az');
    remediation.push({
      dep: 'az',
      why: 'Azure CLI not found -- ADO review REQUIRES an authenticated `az` (the REST token, and the MCP azure-identity path also relies on it).',
      fix: `${HINTS.az.install}\nThen: ${HINTS.az.auth}`,
    });
  } else {
    const acct = run('az account show -o json');
    let signedIn = false; let account = null; let tenantId = null;
    if (acct.ok) {
      try { const j = JSON.parse(acct.out); signedIn = true; account = j.user && j.user.name; tenantId = j.tenantId; } catch { /* unparseable -> treat as not signed in */ }
    }
    deps.az = { present: true, signedIn, account: account || null, tenantId: tenantId || null };
    if (!signedIn) {
      blocking.push('az');
      remediation.push({ dep: 'az', why: 'Azure CLI is installed but not signed in.', fix: HINTS.az.auth });
    }
  }
} else if (platform === 'github') {
  const ghv = run('gh --version');
  const tokenSet = !!process.env.GITHUB_TOKEN;
  deps.githubToken = tokenSet;
  if (!ghv.ok) {
    deps.gh = { present: false, authed: false };
    if (!tokenSet) {
      blocking.push('gh');
      remediation.push({
        dep: 'gh',
        why: 'GitHub CLI not found and GITHUB_TOKEN not set -- GitHub review REQUIRES one of them to read / post.',
        fix: `${HINTS.gh.install}\nThen: ${HINTS.gh.auth}`,
      });
    }
  } else {
    const auth = run('gh auth status');
    deps.gh = { present: true, authed: auth.ok };
    if (!auth.ok && !tokenSet) {
      blocking.push('gh');
      remediation.push({ dep: 'gh', why: 'GitHub CLI is installed but not authenticated, and GITHUB_TOKEN is not set.', fix: HINTS.gh.auth });
    }
  }
}

// Resolve an access method. There is NO offline mode -- a missing platform credential
// (az for ADO, gh/GITHUB_TOKEN for GitHub) is blocking. The markdown Step 0 makes the
// final call, honoring any .github/pr-review.json override.
let recommended = null; const reasons = [];
if (platform === 'ado') {
  if (deps.az && deps.az.signedIn) {
    recommended = mcpConfigured ? 'mcp' : 'rest';
    reasons.push(mcpConfigured ? 'ado-repo-server configured + az signed in' : 'az signed in, no MCP configured');
  }
} else if (platform === 'github') {
  if (deps.gh && deps.gh.authed) { recommended = 'cli'; reasons.push('gh authenticated'); }
  else if (deps.githubToken) { recommended = 'rest'; reasons.push('GITHUB_TOKEN set'); }
}

const report = {
  platform,
  deps,
  access: { recommended, reasons },
  blocking,            // non-empty => STOP and show remediation (node / git / az-or-gh missing)
  remediation,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(blocking.length ? 2 : 0);
