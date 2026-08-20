# Agent Note: Web prompt admission preserves submit order

Status: implemented

English | [中文](2026-08-19-web-prompt-admission-order.zh.md)

## Problem

Each Web image submission serialized its browser files before calling the Session prompt face. A later text-only submission could finish that preparation first and reach the Host ahead of the earlier image. Disposal or session-scope release during `File.arrayBuffer()` also left the pending callback able to prompt a stale SessionFace.

## Decision

The conversation service serializes all prompt admissions by `SessionId`, including composer `sendSession` calls and scoped plugin `send` calls. One session's next operation starts after its predecessor settles, including after rejection, while distinct sessions use independent chains. Each operation captures the current sessions service at admission and verifies the exact SessionFace before work; image submissions verify it again after asynchronous file serialization. Service disposal and session replacement therefore reject before Host prompt dispatch.

## Verification

Client orchestration regressions hold an image read open while a later text submission waits, then verify Host prompt order. Separate cases prove that a rejected predecessor does not poison the chain, a blocked session does not block another session, and disposal or session release during image serialization produces no prompt.

## Alternatives considered

**Lock only the composer state machine.** Rejected because plugins can call the public scoped `conversation.send()` face, and submission order must not depend on which UI sink initiated it.

**Serialize every Web prompt globally.** Rejected because unrelated sessions have independent Host admissions and must retain concurrent progress.

**Let the Host reorder by client timestamp.** Rejected because the Host receives only completed admissions; reconstructing an earlier browser-local intent would add protocol state and would not prevent a stale SessionFace call after teardown.

## Consequences

Large browser files can delay later prompts in the same session but cannot reorder them. Other sessions remain concurrent. Pending image reads reject after their owner disappears, allowing the existing input transaction to restore or release its draft without sending to a stale target.
