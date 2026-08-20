# Agent Note: preserve context capacity provenance

Status: implemented

English | [中文](2026-08-18-context-capacity-provenance.zh.md)

## Problem

Model context metadata carries both a capacity and whether that capacity is an adapter fallback estimate. The runtime accepted malformed provenance values and the agent loop deduplicated records by route and capacity only. A provider could therefore leak a non-boolean marker to the session boundary, or a live configuration could change an unchanged capacity from estimated to exact without updating the durable request context used by the UI and compaction consumers.

## Decision

`LlmRuntime.resolveModelInfo()` accepts context metadata only when `contextWindow` is a positive safe integer and `estimated`, when present, is boolean. Invalid values fail with `INVALID_MODEL_CONTEXT` while the adapter-owned lookup is still the operation reporting the error.

The agent loop compares `contextEstimated` together with provider, model, and `contextWindow` before appending `request/context`. An unchanged capacity with changed provenance therefore produces a new durable record. The context-pressure projection treats every capacity record as a whole value: an omitted estimate marker clears the previous marker instead of inheriting it across routes.

## Verification and boundary

LLM service tests reject an unsafe context integer and a non-boolean estimate marker. Agent-loop request reconstruction tests cover an estimated-to-exact transition at the same route and capacity. Token-meter projection tests cover an estimated capacity followed by a capacity that omits the marker, checkpoint invalidation, route changes, capacity changes, absent capacity, and unchanged capacity. The change does not infer provider capacity, alter compaction policy, or turn an estimate into an exact fact.

## Alternatives considered

**Compare only the numeric capacity.** This keeps the old append rate but leaves the UI and consumers with stale provenance when a deployment replaces a fallback with an exact declaration.

**Validate the marker only when the session appends the event.** This delays an adapter contract error until loop execution and reports it as a session failure instead of an invalid model metadata response.

**Drop the estimate marker from the durable event.** This would avoid the transition but make the user-facing approximation indicator and any downstream policy unable to distinguish declared and fallback capacity.

## Consequences

Capacity provenance is validated at the LLM adapter boundary and remains lossless across request-context deduplication and projection replay. A configuration change that affects only estimate status costs one additional log record, and changing projection semantics invalidates older cached context-pressure state so replay reconstructs the newest complete capacity record.
