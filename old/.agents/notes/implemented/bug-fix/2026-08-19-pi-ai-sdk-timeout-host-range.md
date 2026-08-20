# Agent Note: pi-ai SDK timeouts stay within the host timer range

Status: implemented

English | [中文](2026-08-19-pi-ai-sdk-timeout-host-range.zh.md)

## Problem

The pi-ai profile validated `streamIdleTimeoutMs` against Node's maximum timer delay but accepted any natural number for `timeoutMs` and `websocketConnectTimeoutMs`. pi-ai passes the WebSocket connection value directly to `setTimeout`; Node clamps a delay above `2,147,483,647` milliseconds to about one millisecond. A deployment asking for a longer connection budget could therefore receive an almost immediate timeout, and different provider SDKs could interpret the oversized HTTP timeout inconsistently.

## Decision

Profile schema validation and the shared `resolveProfiles()` boundary accept `timeoutMs` and `websocketConnectTimeoutMs` only as non-negative integers no greater than `MAX_TIMER_DELAY_MS`. Zero remains available because pi-ai defines it as part of these SDK option semantics. `streamIdleTimeoutMs` retains its stricter positive range because the Harness arms that watchdog directly.

Both plugin loading and settings validation use the same resolver, so an oversized SDK timeout fails before the route registration changes or a request reaches a provider. The diagnostic names the provider route, field, and maximum.

## Alternatives considered

**Clamp oversized values to the maximum.** Rejected because a silent correction hides a deployment mistake and changes an explicitly configured duration.

**Rely on pi-ai or each provider SDK.** Rejected because the WebSocket path demonstrably reaches Node's timer with the configured value, while HTTP SDKs do not share one validation rule.

## Consequences

All three pi-ai timeout controls fit the host timer range on every supported platform. Existing values through the exact maximum keep their behavior; larger values fail configuration instead of becoming unexpectedly short deadlines.

## Testing

The adapter profile suite covers rejection through direct resolution and plugin loading and accepts the exact maximum for both SDK timeout fields.
