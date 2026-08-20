# Agent Note: retain warned ripgrep partial results

Status: implemented

English | [中文](2026-08-19-ripgrep-partial-results.zh.md)

## Problem

Ripgrep uses exit 2 for traversal and target errors even when another target produced valid stdout. The search tools treated every exit above 1 as a failure before parsing stdout, so one missing or unreadable path discarded valid `glob` paths or `grep` matches.

## Decision

An exit-2 run may cross the subprocess boundary only when stdout is non-empty and complete and the stderr diagnostic is not a regex or glob parse error. The owning tool then parses the transport and accepts it only when at least one real path or match remains. Accepted canonical values carry an optional warning and Native output appends the bounded stderr diagnostic. Empty, summary-only, malformed, or lossy output still fails with the existing structured error vocabulary.

## Verification and boundary

Unit regressions cover partial `glob` and `grep` results, syntax errors, empty failures, and lossy exit-2 output. The real-ripgrep integration suite retains the existing missing-target-only failure. The focused search suite passes 142 tests with one platform-gated skip.

This does not claim that partial results are complete. The explicit warning preserves that distinction, and callers that require exhaustive results must retry with narrower, accessible targets.

## Alternatives considered

**Treat every exit 2 as failure.** This preserves a simple contract but loses valid evidence from accessible targets.

**Treat any non-empty stdout as success.** `grep --json` can emit summary records without a match, so transport presence alone is insufficient.

**Ignore stderr after parsing results.** That would make an incomplete search look authoritative. The bounded warning is retained in the canonical value and rendered text.

## Consequences

Mixed accessible/inaccessible searches return usable evidence without hiding incompleteness. Invalid patterns and searches with no usable results preserve their previous failures, while truncated stdout remains `SEARCH_RAW_OUTPUT_OVERFLOW`.
