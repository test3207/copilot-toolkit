---
name: dep-audit
description: Audit and fix npm dependency security vulnerabilities — run npm audit across all package locations, analyze root-dep upgrade vs override strategy, classify by severity, apply fixes with user approval, then verify the build and prepare handoff. Use when asked to scan a project for dependency CVEs, produce a fix plan, or update vulnerable packages.
user-invocable: false
---

# Dependency audit & fix

Audit and resolve npm dependency security vulnerabilities. Repo and build config are loaded from the consumer's registry; the workflow itself is registry-agnostic.

## Input resolution

1. Ask the user which repo (or detect from cwd).
2. Read the consumer's `workflows/registry/index.md` to find the repo entry.
3. Read `workflows/registry/<repo>.md` for `path` and `build` config.

Then ask: "Do you have a security alert list (e.g. from ADO / GitHub Dependabot)? If so, provide the file path or paste the content. Otherwise I will run `npm audit` to discover vulnerabilities."

## Workflow

### Step 1 — Audit

IF an alert list was provided:

- Parse it first to build a priority checklist (package name, version, severity, due date).
- These alerts take priority in the fix plan.

Discover package locations by searching for `package.json` files under the repo root. For each location:

1. `cd` to the directory.
2. Run `npm audit --json 2>&1` and capture output.
3. Parse vulnerabilities: name, severity, advisory URL, path.
4. Cross-reference with the alert list (if provided). Mark matched alerts; flag any alert-list items NOT found by `npm audit` for investigation via `npm ls`.

### Step 2 — Analyze root-dep upgrades

Before proposing any overrides, check if root dependency upgrades can solve the problem:

1. Read each `package.json` to list direct dependencies (both `dependencies` and `devDependencies`).
2. For each direct dep that sits in a vulnerability chain:
   - Run `npm view <pkg> dist-tags` to find latest stable.
   - Run `npm view <pkg>@<latest> dependencies` to check whether its transitive deps include fixed versions.
   - Compare with the currently pinned/range version.
3. Classify:
   - **Can upgrade**: semver range already allows it (just `npm update`) or minor-version bump within range.
   - **Cannot upgrade**: pinned to exact version (e.g. vendored SDK packages), or latest still carries the vuln.

### Step 3 — Analyze override strategy

For vulnerabilities NOT solvable by root-dep upgrade:

1. Run `npm view <vuln-pkg> versions` to find available patches.
2. **Same-major first**: prefer a patch/minor version within the current major.
3. **Cross-major only if no same-major patch exists**: explicitly note the breaking-change risk.
4. **Check direct-dep conflicts**: if the vuln package is also a direct dep in that location, a global override will conflict — use a scoped override (`"parent": { "pkg": "version" }`) instead.
5. For each override, determine which locations need it.

### Step 4 — Produce plan and scope

Classify all vulnerabilities into:

- **Must fix** — high + critical (with due dates if available).
- **Optional** — medium + low.
- **No fix available** — no patched version exists.
- **Out of scope** — non-npm (e.g. .NET).

Save the plan to `tmp/dep-plan.md`.

Present the plan to the user. Ask which scope to proceed with. Default: high + critical only.

#### Output format

Return markdown with these sections:

1. **Audit summary** — table: Location | Critical | High | Moderate | Low | Total.
2. **Alert cross-reference** (if alerts provided) — table: Alert | Package | Found by (`npm audit` / alert only / both) | Status.
3. **Root-dep upgrade analysis** — table: Package | Location | Current | Latest | Resolves | Recommendation.
4. **Fix plan** — split into:
   - Must fix (HIGH + CRITICAL): # | Alert | Package | Version change | Strategy | Risk | Location | Resolves.
   - Optional (MEDIUM + LOW): same shape.
   - No fix available: Package | Reason.
5. **Dependency chains** — key `npm ls` traces for complex transitive paths.

Keep output concise. Group related vulnerabilities (same package, multiple CVEs).

### Step 5 — Fix

Wait for approval before making changes. Fix priority order (strict):

1. **Root-dep upgrade** — `npm update <pkg>` if semver range allows pulling a fixed version. Always query through the project's configured registry (read `.npmrc` for the URL), not public `npmjs.org` directly.
2. **Same-major override** — minor/patch bump within the same major. Safe.
3. **Cross-major override** — only when no same-major patch exists. Flag as risky, require build verification.

For each fix:

**Root-dep upgrade:**

- Run `npm update <package>` in the affected location.
- Verify the transitive dep updated via `npm ls <vuln-package>`.

**Override (same-major or cross-major):**

- Edit `package.json`: add entry to the `overrides` section.
- Use an exact version (not a range) for security overrides.
- **Direct-dep conflict check**: if the package is also a direct dependency with a different range, use a scoped override (`"parent": { "pkg": "version" }`) instead.
- If the project uses `resolutions` (yarn/legacy), update that too.

After all edits, run `npm install` in each affected location to refresh the lock files.

### Step 6 — Verify

1. Run the build command from the registry (`build` field, in `buildCwd` relative to repo `path`).
2. Run `npm audit` in each affected location — report before/after comparison.
3. If the build fails from dependency changes, investigate and fix.

### Step 7 — Handoff

1. Save the final plan (with results) to `tmp/dep-plan.md`.
2. Create a branch and commit all changes (`package.json` + lockfiles + any pipeline / runtime-version files touched).
3. Check the CI pipeline's Node version — if local `npm` major differs from the version CI's Node ships, flag for pipeline update.
4. List risk items that need manual testing (cross-major overrides).
5. Track PR / testing status using todo for handoff.
6. Suggest PR description text.

## Registry usage

- `npm view` and `npm install` MUST use the project's configured registry. Read `.npmrc` for the registry URL. Pass `--registry <url>` if authentication is needed, or run commands from within the package directory where `.npmrc` is colocated.
- The caller provides the repo root path; discover package locations dynamically (do not hardcode a directory list — repos vary).

## Rules

- Never edit `node_modules` or `package-lock.json` directly.
- Always query versions through the project's configured registry.
- Prefer root-dep upgrade > same-major override > cross-major override.
- Before proposing a cross-major override: run `npm view <pkg> versions` to confirm no same-major patch exists.
- Before proposing a global override: check whether the package is a direct dep in that location — use a scoped override if so.
