# Agent Note: isolate connection loop lifetimes across restart

Status: implemented

English | [中文](2026-08-18-connection-restart-lifetime.zh.md)

## Problem

`ConnectionController` used one mutable `running` flag for every invocation of `start()`. If `stop()` and `start()` ran while an older loop was awaiting reconnect backoff, the older loop observed the new invocation's `running` value when it resumed. It then opened another stream generation beside the new loop and could replace the controller stored in `current`, leaving one generation outside the next `stop()` call.

## Decision

Every successful `start()` creates one private abort signal for that loop lifetime. `stop()` aborts both that lifetime and its current stream generation. The loop captures its lifetime signal and checks it after readiness, stream failure, state callbacks, and backoff awaits, so a later start cannot make a stopped loop live again. Reconnect backoff listens to the same signal and is released when that lifetime stops.

The existing `running` flag remains only the synchronous idempotency guard for repeated `start()` calls within one active lifetime. It does not authorize asynchronous continuation.

## Verification and boundary

The connection lifecycle suite synchronously stops and restarts from the first `reconnecting` state callback under a fixed backoff delay. It proves that only the original connection and one restarted connection become ready and that exactly one mux stream remains active after the old backoff would have elapsed. Existing cases continue to cover ordinary reconnect, explicit stop, readiness-time stop, and repeated start.

This decision isolates loop ownership inside one `ConnectionController`; it does not serialize the independent mux and host streams or add a cross-stream ordering guarantee.

## Alternatives considered

**Use a monotonically increasing epoch without cancellation.** An epoch check prevents the old loop from opening another generation, but its timer and any future lifetime-owned await continue until they settle. An abort signal both identifies the owner and releases cancellable work.

**Make restart await completion of the prior loop.** Changing `start()` or `stop()` to an asynchronous API would spread lifecycle coordination into every caller. A captured lifetime signal preserves the existing synchronous control API.

**Keep the shared `running` flag and clear `current` more carefully.** No assignment order can make a shared Boolean distinguish an old stopped loop from a newly started loop after an await. The missing information is lifetime identity.

## Consequences

Rapid stop/start cycles retain one connection loop, one mux stream, and one host stream. Stopping during backoff releases the delay immediately, while a later start proceeds independently. The controller now owns one additional `AbortController` per active loop lifetime.
