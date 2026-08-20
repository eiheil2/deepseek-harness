# Agent Note: preserve reasoning default ownership on Web session restore

Status: implemented

English | [中文](2026-08-19-web-session-reasoning-default-restoration.zh.md)

## Problem

The Web gateway restored the latest logged `reasoningEffort` as an explicit session selection without reading the request header's `adapterDefaults.reasoningEffort` marker. A value materialized by the adapter therefore became pinned after resume. If the adapter later changed its default or stopped offering that value, the next request could reject with `UNSUPPORTED_REASONING_EFFORT` instead of resolving the current default.

## Decision

Logged provider and model values still restore the session route. A logged reasoning effort restores only when the header does not mark it as adapter-materialized. An adapter default remains absent from `ModelSelection`, so the ordinary exact-model resolution selects the adapter's current default. Explicit user selections remain unchanged.

## Verification and boundary

The regression records the same `max` effort under both ownership states. Before the repair, the adapter-default case incorrectly appeared in `session.models.current` and the next request proposal, while the explicit case passed. After the repair, the default case produces an effort-free proposal that resolves to the adapter's current `high` default, and the explicit case remains `max`.

The focused regression and TypeScript and Oxlint checks pass. The complete Host API proxy package passes all 382 tests with a 15-second test timeout. Under the default 5-second timeout, an unchanged large-visibility search test exceeded its limit twice during concurrent audit load; its isolated extended-timeout run passed. This change does not alter selections made in the current process or the behavior of `session.selectModel`, which intentionally persists its resolved selection.

## Alternatives considered

**Restore every logged value.** This preserves the exact historical request but loses the header's recorded ownership and converts a former default into a future explicit requirement.

**Drop every logged reasoning effort.** This avoids stale defaults but also discards an explicit user selection that remains valid for the same model.

## Consequences

Resumed Web sessions follow updated adapter defaults without cross-model or cross-version effort contamination. Historical request headers remain exact records of what was sent, while `ModelSelection` contains only the explicit choice that should govern future requests.
