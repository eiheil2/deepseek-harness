# Agent Note: suppress credential events after provider disposal starts

Status: implemented

English | [中文](2026-08-18-credentials-inflight-disposal-events.zh.md)

## Problem

The local credentials provider deliberately drains an atomic write that was already in flight when its service begins disposal. After that write committed, the old implementation unconditionally emitted `credentials/updated`. Cordis had already removed the service from live resolution, so the credentials invariant rejected the event. The durable write and provider snapshot succeeded while the caller observed a failed `set()`, and without the invariant an event still escaped its provider lifetime.

## Decision

An operation already inside the atomic write retains its existing completion semantics: it reaches disk and updates the old provider's in-memory snapshot. The provider checks its opaque `closed` state immediately before event publication and suppresses the event once teardown has started. A write still queued behind it rechecks liveness and rejects without reaching storage.

## Alternatives considered

**Cancel the in-flight write.** Atomic replacement may already have crossed an irreversible filesystem boundary. Pretending cancellation is available could leave the caller and disk in a less knowable state.

**Emit through a replacement credentials service.** The completed write belongs to the old provider and its document. Lending its event to a new service would misattribute ownership and could notify consumers about a different store.

**Treat the invariant failure as success.** Catching the invariant would hide a real lifecycle violation and make future invalid events harder to diagnose. Preventing the post-disposal event preserves the invariant instead.

## Consequences

Provider disposal remains a quiescence boundary for events without discarding a write that has already entered its atomic commit. A retained old service handle can observe the coherent completed snapshot, but live consumers receive no event from an owner that has left the service registry. The deterministic regression gates the real atomic writer, verifies disk and snapshot completion, rejects the queued successor, enables the credentials invariant, and observes zero post-disposal events.
