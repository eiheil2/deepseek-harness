# Agent Note: Code Mode child ids survive root call-id reuse

Status: implemented

English | [中文](2026-08-19-code-mode-dispatch-id-reuse.zh.md)

## Problem

Code Mode generated each child id as `<root>:code:<ordinal>`, with the ordinal reset for every `run_code` execution. Provider call ids can legally repeat across assistant steps, so two durable child events could receive the same id and client projections could pair or update the wrong child.

## Decision

The Code Mode bridge allocates a fresh `randomUUID()` execution namespace before the first await of every `run_code` execution and emits `<root>:code:<execution-namespace>:<ordinal>`. The namespace is owned by the execution rather than an in-memory registry, so concurrent runs, registry reloads, process restarts, and cross-step provider root-id reuse cannot recreate a child id. The generic session invariant continues to reject duplicate tool-call ids within one assistant step.

## Verification

The Code Mode regression executes two runs with the same root call id and asserts unique start and settle ids with one-to-one pairing. Client fixtures emit the same namespaced shape with stable injected namespaces, while durable historical replay fixtures retain their existing opaque ids. The complete core tools test package passes.

## Alternatives considered

**Reject every repeated root call id.** Rejected because session semantics clear the duplicate-id set at step boundaries and explicitly permit provider ids to recur across turns.

**Keep the deterministic ordinal and remember used roots in memory.** Rejected because a registry reload or process restart loses the history, while retaining every root indefinitely leaks memory in a long-lived process.

**Use a deterministic token derived from the provider root id.** Rejected because the same root id is the collision input; no deterministic derivation can distinguish two executions that carry identical inputs.

**Deduplicate in the client tree.** Rejected because the durable event identity would still be ambiguous for every other consumer and replay path.

## Consequences

Child ids are slightly longer and intentionally random, while the submission ordinal remains stable within one execution. No registry-lifetime history is retained, and the namespace remains unique across registry reloads and process restarts under the UUID collision model.
