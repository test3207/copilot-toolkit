# C# Coding Standards

Applies to C# / .NET repositories. Load after `common.md`.

## General

- Follow .NET naming conventions (PascalCase for public, camelCase for private)
- Use `var` when type is obvious from RHS
- Prefer `async/await` over `.Result` or `.Wait()`
- Use nullable reference types (`#nullable enable`)

## External-Response Filters (Azure SDK / ARM)

When catching `RequestFailedException` (or any SDK exception backed by an HTTP response) and disambiguating with a `when` clause, do NOT assume the SDK field that "looks symbolic" carries the symbolic value. Verify against the actual server emitter.

- `RequestFailedException.Status` -> `int` HTTP status (e.g. `404`).
- `RequestFailedException.ErrorCode` -> `string?` populated from `error.code` in the response body. Many internal RPs emit the **HTTP status code as a string** here (e.g. `"404"`) instead of a symbolic name. Do NOT assume CamelCase.
- `RequestFailedException.Message` -> includes the full body; the symbolic disambiguator (e.g. `"SessionHost does not exist"`) often lives only here as a literal string from a shared constants file.

Before writing a `when` filter:

1. Find the server-side emitter (grep the RP source for `NotFound(` / `CreateErrorMessageObject(` / `Problem(` near the endpoint).
2. Match against the field the emitter actually populates (`error.code` vs `error.message` vs `error.target`).
3. Add an inline comment with `file#line` of the emitter so the next maintainer can re-verify.

Failure to do this can ship a 100%-failing probe that passes local UTs (mock-as-spec trap).

## TODO

- Add project-specific conventions when first C# repo is onboarded
