# Agent Note: pi-ai Codex transport state uses an authenticated request scope

Status: implemented

English | [中文](2026-08-19-pi-ai-codex-transport-scope-isolation.zh.md)

## Problem

pi-ai's Codex Responses implementation caches a process-local WebSocket connection, its SSE-fallback decision, and response continuation state under the SDK `sessionId` alone. Passing the durable Harness session id unchanged lets the same session reuse a connection and authorization state after its provider route, model, endpoint, configuration, headers, or credential changes. A request can therefore travel over an earlier endpoint's authenticated connection and inherit its continuation or fallback state.

## Decision

The adapter gives pi-ai an opaque SDK session-scope id only when a request has both a Harness session id and an explicitly resolved credential. A process-random secret keys an HMAC over the Harness session, provider route, model id, model API, model endpoint, route-local cache generation, sorted effective request headers, and credential. The fixed-length result stays below pi-ai's 64-character `sessionId` limit, is stable for an identical scope inside one process, and reveals none of the scope inputs to the provider. The same scoped value covers every protocol's provider-visible cache or affinity metadata; Codex's connection and continuation caches are the reproduced high-impact case.

Each provider route compares a stable fingerprint of its cache-affecting profile and model descriptors, and only that route's opaque generation changes when the fingerprint changes. A route's generation is retained only in the current immutable snapshot; removing a route drops its scope, so re-adding it also receives a fresh generation instead of reviving old SDK state, without an unbounded history map. Replacing or editing another route therefore leaves this route's pi-ai transport state reusable. Endpoint, provider, model, headers, or credential changes on the target route produce another id, so WebSocket reuse, SSE fallback, and `previous_response_id` continuation remain within one authenticated request scope.

A request with no Harness session id keeps the SDK id absent. A request using provider-native ambient credential discovery also omits it: the adapter cannot identify the credential selected inside pi-ai, so it cannot prove that two calls share an authentication context. Those calls retain ordinary request behavior but do not share pi-ai's session affinity or caches, including Codex's persistent transport and continuation state.

## Verification

Pure scope tests pin deterministic same-input output, the length limit, absence of raw scope values, isolation across every scoped field, and omission for ambient credentials. Fake-WebSocket integration tests pin same-scope connection reuse, new connections after endpoint/profile or credential changes, route removal and re-addition, absence of an old `previous_response_id` on the new scope, and independence from an earlier scope's SSE-fallback state. The package's existing adapter and replay tests cover unchanged non-Codex behavior without network access.

## Alternatives considered

**Forward the Harness session id unchanged.** Rejected because a durable conversation identity does not identify the provider connection, endpoint, configuration, headers, model, or credential that pi-ai cached beneath it.

**Hash the credential with plain SHA-256.** Rejected because a provider-visible unsalted credential digest would give an observer an offline oracle for testing candidate credentials. A process-secret HMAC makes the transmitted id useless for that attack and intentionally prevents reuse across process restarts.

**Reuse ambient-authenticated sessions by omitting credential identity from the scope.** Rejected because pi-ai resolves that credential outside the adapter. Treating an unknown identity as stable would recreate the authentication-crossing defect this change closes.

**Disable SDK session ids for every request.** Rejected because explicit credentials provide enough identity to isolate reuse safely; removing all persistence would discard connection and continuation efficiency where the adapter can prove the scope.

## Consequences

pi-ai session affinity and caches no longer cross route, model, endpoint, configuration, header, or explicit-credential changes within one Harness session. Removing and re-adding a route also cannot revive its old SDK state, and route history does not accumulate without bound. Stable explicitly authenticated requests retain in-process cache reuse, including Codex connection and continuation reuse. Process restarts deliberately produce new ids, and ambient-authenticated requests give up cross-call reuse; both costs follow from keeping credential material unverifiable and unknown credentials unshared.
