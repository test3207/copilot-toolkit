---
name: coding-standards
description: Shared coding standards (style, accessibility, error handling, security, language-specific rules) consumed on demand by other tools' implementer subagents. Not user-facing; loaded explicitly by the requesting agent based on a per-repo file list declared in the consumer's registry.
user-invocable: false
disable-model-invocation: true
---

# Coding Standards

Generic coding standards split by scope. Each consuming tool's implementer subagent
(e.g. `work-implementer`) receives the per-repo file list from the registry and reads
the matching files from THIS directory.

## Files

| File | Scope |
| ---- | ----- |
| [common.md](./common.md) | All repositories regardless of tech stack — style, accessibility, error handling, security. |
| [typescript.md](./typescript.md) | TypeScript / React repositories. Loads after `common.md`. |
| [csharp.md](./csharp.md) | C# / .NET repositories. Loads after `common.md`. |

## Resolution

Consumer registry entries declare which files apply per repo via a `coding-standards`
field listing bare filenames in load order. Example:

```text
| coding-standards | common.md, typescript.md |
```

The requesting agent prepends `{toolkit-root}/skills/coding-standards/` (where `{toolkit-root}` is the path resolved by the entry prompt — `.copilot-toolkit/.github` when consumed via submodule, `.github` when self-hosted) to each entry. The
registry stays compact; the directory is a fixed convention.

Repos that ship their own root-level standards (e.g. `CONTRIBUTING.md`) can set the
registry value to a pointer (`See CONTRIBUTING.md`) — the agent then reads the named
file instead.
