# Agent Note: close the HTTP stream backpressure race

Status: implemented

English | [中文](2026-08-19-http-bridge-close-race.zh.md)

## Problem

The Node HTTP bridge waited for `drain` or `close` only after `res.write()` returned false. If the client had already closed, or close fired synchronously during that write, neither event would be delivered to the new listeners. A late buffered response chunk could therefore leave `bridge()` pending forever even though the request signal was already aborted.

The browser event downlink uses WebSocket, but streamed `/api/session.export` responses and extension routes still use this bridge. Repeated cancelled streams could retain handlers, response listeners, and body readers.

## Decision

The bridge treats the response's destroyed state and the request abort signal as level state, not only one-shot events. It checks before every write. After a backpressured write, it subscribes to drain, close, and abort, then checks state again to cover a close that raced with listener registration. Disconnect exits the async iteration, cancelling the WHATWG response body. The bridge calls `end()` only for a response that remains writable.

## Verification and boundary

A deterministic response emits close synchronously inside `write()` before returning false. The bridge now settles, writes once, cancels the body, and does not call `end()`. A real `node:http` regression destroys the client after its first chunk while the producer later enqueues a buffered chunk; the bridge settles and cancels that producer. The complete connection package passes 110 tests, and its TypeScript project and changed-file Oxlint pass.

This is lifecycle and backpressure correctness. It does not claim that every upstream producer reacts to abort immediately, nor does it classify the race as a security-boundary bypass.

## Alternatives considered

**Wait only for `close`.** EventEmitter does not replay close to a listener registered after the event.

**Rely only on the request AbortSignal.** The producer can still yield an already buffered chunk after observing cancellation.

**End every response after iteration.** Calling `end()` on a destroyed socket confuses normal completion with client disconnect and is unnecessary.

## Consequences

Normal backpressure still waits for drain. Normal completion still ends the response. Client disconnect now stops writes, releases the body iterator, and settles the handler even when close races with a backpressured write.
