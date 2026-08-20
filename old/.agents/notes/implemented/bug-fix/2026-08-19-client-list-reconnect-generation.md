# Agent Note: client list pulls are isolated by connection generation

Status: implemented

English | [中文](2026-08-19-client-list-reconnect-generation.zh.md)

## Problem

Session and Workspace list RPCs can outlive the WebSocket generation that started them. A reconnect reused the old single-flight promise, and a late response or `finally` handler could install a dead baseline or clear the replacement pull. The visible list could therefore remain stale until a manual refresh.

## Decision

`SessionManager` and `WorkspaceManager` keep monotone list-pull generations. Disconnect increments the generation and clears the single-flight reference and mutation replay buffer without requiring the underlying unary request to be cancellable. A new pull starts after reconnect. Response and transport-error paths publish only when their captured generation is current. The settlement path clears state only when its promise is still the current in-flight identity. `WorkspaceRuntime` forwards the same disconnect invalidation from the connection owner.

## Verification

Client regressions hold a pre-reconnect RPC, assert a second RPC starts after reconnect, settle the old request while the replacement is pending, and verify that the old response and settlement cannot replace or clear the new state. Catalog debounce timers are cancelled when a connection generation ends and during runtime teardown, so no post-disconnect `subagents.list` starts from an old timer. The complete client runtime test package passes.

## Alternatives considered

**Abort every old unary request.** Rejected because the client API does not require every unary implementation to accept a connection-owned `AbortSignal`; generation checks provide the same publication guarantee without coupling the managers to transport cancellation.

**Keep reusing the old promise.** Rejected because the response describes the dead connection's baseline and provides no evidence that the new generation has been hydrated.

**Use a wall-clock timestamp.** Rejected because ordering is a lifecycle property, not elapsed time; a monotone generation and promise identity are deterministic and do not depend on clock resolution.

## Consequences

An old request may still consume transport resources until it settles, but it cannot mutate list state or interfere with the replacement request. Reconnects perform a fresh baseline pull for both list owners, and frames arriving during that pull continue to replay over its response. Runtime teardown also invalidates both managers before stopping the connection loop.
