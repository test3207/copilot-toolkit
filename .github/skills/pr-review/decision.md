# PR Review Decision Rules

Loaded by the **main agent in workflow Step 8** when assembling TL;DR, Action Items, and verdict. Subagents do not need this file -- they emit findings; the main agent decides verdict and constructs the checklist.

## Review Decision Guide

| Condition | Decision |
| --------- | -------- |
| No issues found | Approve |
| Only Low severity issues | Approve |
| Medium issues, easily fixable, no user-facing regression | Approve with Comments |
| Any Bug (potential) at Medium+ on a standard user workflow | Request Changes |
| Multiple Medium issues | Request Changes (non-blocking) |
| Any High severity issue | Request Changes |
| Missing corner case handling | Request Changes |

## Verdict Escalation Rule

The verdict is determined by the **highest-severity actionable finding**, not the overall regression risk score.

- **"Regression Risk: Low"** describes the probability/blast radius of regressions across all callers.
- **"Bug (potential): Medium"** describes a specific finding that has a concrete repro on a standard user workflow.

These are independent assessments. A single Medium Bug (potential) with a standard-workflow repro **overrides** an overall Low regression risk and escalates the verdict to **Request Changes**.

**Escalation logic:**

```text
IF any finding is classified as Bug (potential) or Bug (confirmed)
  AND severity >= Medium
  AND simplest repro is a standard user workflow (not an edge case)
THEN verdict = "Request Changes"
     blocking_issues >= 1
```

> The author-facing tag this verdict keys off (Kind `Bug` + Severity) and its rendering are defined in [tags.md](tags.md). This file owns the verdict thresholds; tags.md owns the tag set.

**Common anti-pattern (worked example):**

1. Corner Case #1 correctly identified: networkHciDropdown placeholder mismatch, 3-step standard workflow, classified as Bug (potential) Medium.
2. But TL;DR said "Blocking Issues: None" and verdict was "Approve with Comments."
3. Root cause: the agent used overall regression risk (Low) to determine the verdict instead of the highest-severity finding.
4. Fix: Always derive verdict from findings, not from regression risk.

## Action Items Construction (Gates)

The Action Items section MUST be empty when the PR is clean -- an empty list on a clean PR is the correct outcome.

Run every candidate item through these gates. If it fails any gate, drop it.

| Gate | Question | Drop if... |
| ---- | -------- | ---------- |
| **G1: Concrete defect** | Is there a specific, reproducible bug, regression, or violated invariant in *this diff*? | The item asks the author to confirm a pre-existing invariant the diff doesn't touch. |
| **G2: Author-fixable** | Can the *author* act on it by editing this diff (or a follow-up code change)? | The action is "go check a thing" out-of-band, not "change a thing". Ask inline instead. |
| **G3: Purpose vs. incidental effect** | If claiming a symbol/branch is now redundant, did you re-read its **declared purpose** (comment, condition, callers) -- not just the side effect this PR removed? | Redundancy claim is based only on the side effect this PR happened to remove. Always grep the symbol and read its primary use site first. |
| **G4: Asymmetric cost** | Is acting on this item cheaper than ignoring it? | Speculative concern (e.g. "consider renaming for future readers") with no concrete confusion observed. |

**Smell**: items beginning with "Confirm...", "Verify...", "Consider..." usually fail G1 or G4. Rewrite as a concrete defect ("X breaks scenario Y") or delete.

**If zero items survive**: write `(none)`.
