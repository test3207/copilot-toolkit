# Work Design Anti-Patterns

Loaded by `work-architect-explorer` and `work-rca-tracer` subagents in their fresh windows.
Main agent does NOT read this file — it only passes the path to subagents.

Cross-check every proposal against these before returning output. Flag matches in the
"Risks / Open Questions" section of the subagent output.

---

## DAP-01: Patch the symptom layer

Stopping at the nearest writable file instead of the actual decision point.
- **Symptom in proposal**: touching 6 files when 1 interface swap would do, or fixing a
  log/UI message instead of the data source feeding it.
- **Detection**: when touch points form a wide horizontal band at the same layer (UI
  blades, controllers, log emitters) but no entry into the layer below, the proposal is
  almost certainly symptom-layer.
- **Counter**: walk one layer down from the proposed touch and ask "could one change
  here replace N changes above?"

## DAP-02: Reimplement instead of swap

Rewriting an existing component when a DI seam, strategy slot, or feature-flag branch
already exists nearby.
- **Detection**: proposal creates a new sibling file (`*V2.ts`, `*New.cs`, `*WithX.ts`)
  but the directory already contains an interface / abstract class / strategy registry.
- **Counter**: list the seams found in Task 3 (Interface / DI seam inventory). If any
  seam can carry the new behavior, prefer implementing it over creating a parallel
  class. Only fall back to parallel clone when the seam genuinely can't carry the delta
  (e.g. type signatures incompatible) — and SAY so explicitly.

## DAP-03: Modify product code for an independent tool

When the user asked for a wrapper / harness / standalone tool / analyzer, NEVER plan to
modify the system being wrapped.
- **Detection**: any touch point lives inside the wrapped system's source tree.
- **Counter**: re-read the user's original ask. If "tool / harness / analyzer / wrapper"
  appears, all touch points must live outside the wrapped system's tree. The wrapped
  system is read-only.

## DAP-04: Trust silent success

Any framework that can swallow exceptions (NoThrow, catch-all, fire-and-forget, async
without await, observable without subscriber) must have explicit verification planned.
- **Detection**: proposal relies on "X will be set" / "Y will fire" without a
  verification step.
- **Counter**: add a verification artifact to the design — log assertion, return-value
  check, integration-test assertion, or a manual repro step. Never write "should work"
  without telling the user how they'll know.

## DAP-05: Aspirational schema

When the design references fields / events / hooks / API surfaces, grep to confirm they
exist. If they don't, mark as "instrumentation needed" with file path + change required,
not as a direct mapping.
- **Detection**: design uses field names / event names that the subagent has not
  actually grepped for in this session.
- **Counter**: every claim "X carries Y" / "X lives at Y" must be backed by a
  `file#line` from the actual repo, not memory. Missing? -> "instrumentation needed"
  section, not a mapping.

## DAP-07: Cross-runtime file sharing (multi-framework repos)

Applies whenever the repo hosts code that builds through TWO OR MORE module pipelines with different roots (e.g. an older view framework + a newer one in the same codebase) AND the proposal introduces a "shared" file (constants, utils, types, view-model fragment) intended to be imported by both sides.
- **Why it fails**: distinct pipelines resolve module paths from different roots; a single source file cannot satisfy both sides' imports. The "extract a common helper" instinct does not compile here.
- **Detection**: any touch-point table row that names a new file whose consumers list spans both runtime trees; OR a refactor that moves an existing single-runtime file to a "shared" location and adds an import from the other runtime.
- **Counter**: pick one:
  1. Duplicate the value on each side with a comment linking the twin (cheapest for small constants/types).
  2. Move the value into a source both sides already consume independently (resource file, server-served config, feature-flag service, environment value).
  3. Keep the logic on one side and expose it via an event / message both sides already speak.
  Mark the chosen option in the design output; never propose option 0 (single shared source file).

## DAP-06: Skip the rejection list

A design without rejected alternatives is a design that hasn't been thought through.
- **Detection**: minimal-intervention-point statement has no "rejected alternatives".
- **Counter**: produce >=2 rejected alternatives with one-line reasons each. If you
  genuinely can't think of any, the problem is probably too narrowly scoped — go up
  one level and re-explore.

## DAP-08: Fabricated external-contract magic strings

Whenever the design includes a literal string / number / enum that is compared against a value emitted by ANOTHER process (HTTP response body field, SDK exception's `ErrorCode` / `Status` / `Message`, header name, ARM error.code, incident ResType, event name, telemetry field), the literal MUST come from a real observation -- not from naming intuition or SDK-convention guesses.
- **Why it fails**: AI-invented symbolic names ("looks like an enum value, must be the ErrorCode") are self-validating fiction. Local UTs pass because mocks return the invented value; only real service traffic exposes it. Cost can be 100% feature failure shipped to canary.
- **Detection in a proposal**: any of these in the design output WITHOUT an evidence anchor:
  - `catch (... ex) when (ex.ErrorCode == "...")` / `ex.Code == ...` / `ex.Message.Contains(...)`
  - `switch (response.Code) { case "...": }` / `if (response["status"] == "...")`
  - Hardcoded header keys for an external API (`"x-ms-correlation-..."`)
  - String compares against ARM error.code, ProblemDetails.title, SignalR event types, Service Bus message labels, etc.
  - SDK exception field reads where the field's typed semantics (numeric vs string code, message format) are assumed without docs.
- **Counter** (require at least ONE for each external-contract literal in the design):
  1. **Telemetry citation**: Kusto query showing the actual emitted value (`take_any(ResDesc)`, `summarize count() by ErrorCode`), pasted in the design with date.
  2. **Sibling-handler citation**: `file#line` of another handler in the same codebase already matching the same endpoint -- copy its constant, do not invent a parallel.
  3. **Service-source citation**: `file#line` in the server / RP source that emits the value (e.g. `return NotFound(CreateErrorMessageObject("404", ArmConstants.Errors.SessionHostDoesNotExist, ...))`).
  4. **User-pasted real response**: user pastes one real response body / link to the service contract.
- **In design output**: every such literal gets an inline annotation like `// observed in <kusto query / file#line / contract doc> on <date>`. Designs WITHOUT this annotation cannot leave `[Review Confirm]`.
- **Do NOT trust as evidence**: SDK naming conventions ("Azure SDK usually CamelCases ErrorCode"), local UT mocks (the mock returns whatever value you tell it to -- not proof), the type name of the exception, or "it compiled".
