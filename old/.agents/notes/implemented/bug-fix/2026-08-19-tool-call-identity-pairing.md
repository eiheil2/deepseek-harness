# Agent Note: pair tool transcripts by call identity

Status: implemented

English | [中文](2026-08-19-tool-call-identity-pairing.zh.md)

## Problem

Compaction classified tool-pair boundaries by incrementing for every assistant tool-call block and decrementing for every tool result. Equal counts appeared balanced even when the result named a different `callId`. The optional SessionInvariant separately required a result to follow some `tool/call` event in the step, but did not relate that execution event back to the assistant block identity. A custom executor or seeded log could therefore carry an internally mismatched transcript that compaction treated as safe to cut.

## Decision

Compaction now folds the current surface through a set of open `callId` values. Assistant blocks add identities; results remove the same identities. A mismatched result or duplicate still-open identity is corrupt, while independent results may arrive in any order.

SessionInvariant tracks assistant-declared identities separately from started calls. Once an assistant message exists in a step, each `tool/call` must consume a declared identity and a synthetic not-started result must name a declaration that never started. Duplicate assistant identities reject. For compatibility, a custom or legacy step with no assistant message retains the previous tool-call/result checks.

## Verification and boundary

Before repair, both focused regressions failed: SessionInvariant accepted `model-call` followed by `different-execution`, and compaction returned balanced for `model-call` followed by result `different-result`. After repair both reject. Duplicate assistant identity also rejects, while two parallel results in reverse order remain valid. The complete session and compaction package run passes 466 tests; both TypeScript projects and changed-file Oxlint pass.

This establishes transcript identity integrity for these two owners. It does not make SessionInvariant mandatory, validate tool semantics, or prove that arbitrary extension events belong to a tool call.

## Alternatives considered

**Fix only SessionInvariant.** The companion is optional, so compaction must still reject a corrupt surface independently.

**Fix only compaction.** Invalid execution logs would remain accepted until a later consumer happened to inspect their surface.

**Pair by order.** Parallel tool results can complete in any order; `callId` is the durable relation.

## Consequences

Compaction no longer mistakes equal counts for a valid tool pair. Canonical execution logs fail at their earlier invariant boundary when assistant and execution identities diverge, without rejecting legacy steps that never recorded an assistant message.
