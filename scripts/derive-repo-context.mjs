// Derive repo context from a git remote URL (registry-less / derive-fallback path).
// Usage: node scripts/derive-repo-context.mjs "<git remote url>"
//   e.g. node scripts/derive-repo-context.mjs "$(git remote get-url origin)"
// Output: JSON { platform, org?, project?, owner?, repoName }
//   platform: "ado" | "github" | "gitlab" | "unknown"
//   ADO    -> { platform:"ado", org, project, repoName }
//   GitHub -> { platform:"github", owner, repoName }
//   GitLab -> { platform:"gitlab", owner, repoName }   (owner = full namespace path)
//
// Pure URL parser (no git/network calls) so it stays testable and bundlable into a
// plugin. The caller feeds the output of `git remote get-url origin`. When no entry
// in the consumer registry matches the repo, pr-review uses this to build the same
// repo-context shape a registry entry would have provided.

const input = process.argv[2];

if (!input || !input.trim()) {
  console.error(JSON.stringify({ error: "No remote URL provided" }));
  process.exit(1);
}

// Strip a trailing ".git" and surrounding whitespace.
const url = input.trim().replace(/\.git$/i, "");

const patterns = [
  // ADO (dev.azure.com, optional "<org>@" userinfo): https://[<org>@]dev.azure.com/<org>/<project>/_git/<repo>
  {
    regex: /^https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/i,
    extract: (m) => ({ platform: "ado", org: m[1], project: m[2], repoName: m[3] }),
  },
  // ADO legacy: https://<org>.visualstudio.com/[DefaultCollection/]<project>/_git/<repo>
  {
    regex: /^https?:\/\/([^.]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/]+)/i,
    extract: (m) => ({ platform: "ado", org: m[1], project: m[2], repoName: m[3] }),
  },
  // ADO SSH: git@ssh.dev.azure.com:v3/<org>/<project>/<repo>
  {
    regex: /^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)/i,
    extract: (m) => ({ platform: "ado", org: m[1], project: m[2], repoName: m[3] }),
  },
  // GitHub HTTPS: https://github.com/<owner>/<repo>
  {
    regex: /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+)/i,
    extract: (m) => ({ platform: "github", owner: m[1], repoName: m[2] }),
  },
  // GitHub SSH: git@github.com:<owner>/<repo>
  {
    regex: /^git@github\.com:([^/]+)\/([^/]+)/i,
    extract: (m) => ({ platform: "github", owner: m[1], repoName: m[2] }),
  },
  // GitLab HTTPS (owner may be a nested group path): https://gitlab.com/<group/.../subgroup>/<repo>
  {
    regex: /^https?:\/\/(?:[^@/]+@)?gitlab\.com\/(.+)\/([^/]+)$/i,
    extract: (m) => ({ platform: "gitlab", owner: m[1], repoName: m[2] }),
  },
  // GitLab SSH: git@gitlab.com:<group/.../subgroup>/<repo>
  {
    regex: /^git@gitlab\.com:(.+)\/([^/]+)$/i,
    extract: (m) => ({ platform: "gitlab", owner: m[1], repoName: m[2] }),
  },
];

let result = null;

for (const { regex, extract } of patterns) {
  const match = url.match(regex);
  if (match) {
    result = extract(match);
    break;
  }
}

if (!result) {
  result = { platform: "unknown", message: "Unrecognized git remote host", remote: url };
}

console.log(JSON.stringify(result));
