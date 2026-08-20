# Agent Note: pin admitted calls to one tool registration generation

Status: implemented

English | [中文](2026-08-18-tool-registration-generation.zh.md)

## Problem

The tool runtime resolved the live registry independently when a call entered the policy pipeline and when its body eventually dispatched. A tool that was unknown at entry could therefore become executable if it was registered while `tools/pre-execute` awaited. Likewise, an admitted tool could be disposed, shadowed, or replaced before dispatch and the same call would silently execute the new registration. The agent loop might already have classified the call as parallel from the old definition, so an exclusive replacement could run under a concurrency grant it never made.

Definition object identity was not enough to close the gap: a plugin can dispose and re-register the same object, producing a new effect-owned registration generation with the same JavaScript reference.

## Decision

Each `ToolLayer` stores an internal `ToolRegistration` record around the trusted definition. Every successful `register()` call creates a distinct record, even when a definition object is reused. `createExecution()` captures the exact visible record before pre-policy. Body dispatch, around-wrapper success normalization, and post-policy value replacement proceed only while that record remains the current visible executable route.

Removing, restricting, shadowing, replacing, or re-registering the route before body invocation makes the admitted call fail closed as `UNKNOWN_TOOL`. Calls entering after the change resolve the new registration normally. The reserved Code Mode transport uses one stable record for the runtime lifetime.

The boundary does not revoke a body after invocation. Started work still follows the cooperative cancellation and quiescence contract: it observes or forwards `exec.signal`, settles its owned work, and only then returns.

## Verification and boundary

Deterministic Promise gates cover a previously unknown raw tool registered during pre-policy, a parallel definition replaced by an exclusive definition, a global route shadowed by a late scoped registration, and disposal followed by re-registration of the same definition object. The complete tools, Code Mode, agent-loop scheduling, timeout-policy, and persistent-Bash affected suite passes.

Definitions remain trusted same-process objects. Mutating fields of one still-registered definition in place does not create a new registration generation. Registry changes can cause an already-admitted but not-yet-dispatched call to fail even when an equivalent registration immediately replaces it; this is the deliberate fail-closed result.

## Alternatives considered

**Keep resolving the live definition at every stage.** This lets HMR update an already-admitted call, but it also permits retroactive authorization and can dispatch a tool under another definition's concurrency classification.

**Snapshot only the definition object.** This blocks ordinary replacement but misses dispose and re-register of the same object, so it does not model effect ownership or HMR generations correctly.

**Always execute the captured definition after it unregisters.** This preserves call continuity but invokes capability code after its owner declared teardown. It also prevents restrictions installed during pre-policy from failing closed.

**Reclassify immediately before body dispatch.** This cannot safely turn a call exclusive after the scheduler has already overlapped it with sibling parallel calls, and it still leaves unknown-at-entry calls retroactively authorized.

## Consequences

One call now has one registration identity across lookup, concurrency admission, policy, dispatch, and output-contract normalization. HMR remains live for later calls while admitted calls cannot cross plugin generations. Pre-dispatch churn is observable as `UNKNOWN_TOOL`, trading occasional retryable failure for deterministic capability ownership and fail-closed scheduling.
