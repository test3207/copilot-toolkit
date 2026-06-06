// Parse user input (URL or raw ID) into structured JSON.
// Usage: node tools/parse-input.mjs "<input>"
// Output: JSON { type, id, org?, project?, repoName? }

const input = process.argv[2];

if (!input) {
  console.error(JSON.stringify({ error: "No input provided" }));
  process.exit(1);
}

const patterns = [
  // ADO PR: https://<org>.visualstudio.com/<project>/_git/<repo>/pullrequest/<id>
  {
    regex: /^https?:\/\/(\w+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/i,
    extract: (m) => ({ type: "pr", id: m[4], org: m[1], project: m[2], repoName: m[3] }),
  },
  // ADO PR (dev.azure.com): https://dev.azure.com/<org>/<project>/_git/<repo>/pullrequest/<id>
  {
    regex: /^https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/i,
    extract: (m) => ({ type: "pr", id: m[4], org: m[1], project: m[2], repoName: m[3] }),
  },
  // ADO WI: https://<org>.visualstudio.com/<project>/_workitems/edit/<id>
  {
    regex: /^https?:\/\/(\w+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_workitems\/edit\/(\d+)/i,
    extract: (m) => ({ type: "wi", id: m[3], org: m[1], project: m[2] }),
  },
  // ADO WI (dev.azure.com): https://dev.azure.com/<org>/<project>/_workitems/edit/<id>
  {
    regex: /^https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_workitems\/edit\/(\d+)/i,
    extract: (m) => ({ type: "wi", id: m[3], org: m[1], project: m[2] }),
  },
];

// ICM matcher is consumer-overridable: set ICM_HOST_PATTERN to a regex fragment
// that matches your incident-management portal host (e.g. "portal\\.example\\.com").
// Upstream ships zero host knowledge; the consumer wires its host via env (commonly
// `terminal.integrated.env.*` in .vscode/settings.json or a workspace-local .env).
const icmHostPattern = process.env.ICM_HOST_PATTERN;
if (icmHostPattern) {
  patterns.push({
    regex: new RegExp(`^https?:\\/\\/${icmHostPattern}\\/.*\\/incidents\\/details\\/(\\d+)`, "i"),
    extract: (m) => ({ type: "icm", id: m[1] }),
  });
}

let result = null;

for (const { regex, extract } of patterns) {
  const match = input.match(regex);
  if (match) {
    result = extract(match);
    break;
  }
}

if (!result) {
  // Raw number
  const numMatch = input.trim().match(/^(\d+)$/);
  if (numMatch) {
    result = { type: "unknown", id: numMatch[1] };
  } else {
    result = { type: "error", message: "Unrecognized input format" };
  }
}

console.log(JSON.stringify(result));
