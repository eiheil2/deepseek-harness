# Agent Note: LLM transport retries preserve route and controls

Status: implemented

English | [中文](2026-08-19-frozen-llm-retry-request.zh.md)

## Problem

AgentLoop reran the `agent/request` waterfall and adapter model resolution after a recoverable transport failure. Routing state or adapter defaults changed during backoff could send the retry to another provider or model, or with a different output-token cap, even though recovery is defined for the same explicit provider/model request.

## Decision

The first attempt of each step freezes its canonical request header after `agent/request` and adapter-default resolution. A retry reuses the effective config and skips the request waterfall. It still creates a fresh one-shot `PreparedLlmCall`, so adapter registration lifecycle and single-dispatch enforcement remain intact. Adapter resolution may validate the frozen explicit config but cannot replace it; a changed result fails with `INVALID_PREPARED_CALL` instead of silently changing the request.

Messages remain derived from the current durable session surface immediately before each dispatch. This preserves the agent-loop reconstruction invariant when a plugin legitimately appends or replaces visible history during recovery. Failed attempt chunks are log-only and do not change that surface, so an ordinary transport retry retains the same message body.

## Verification

Agent-loop regressions pause recovery after the first failed attempt, then independently change the `agent/request` provider/model/output cap and the adapter-owned default output cap. Both attempts receive identical provider, model, and `maxTokens`; the waterfall runs once, model resolution runs once per attempt, and only one request header is logged. A separate recovery replaces the durable surface with a valid `sourceEventSeqs` binding and verifies that the retry uses the replacement rather than stale messages. Existing transport recovery covers identical wire bodies when the durable surface is unchanged and successful recovery through a new prepared call.

## Alternatives considered

**Rerun routing and only reject provider/model changes.** This would still allow reasoning effort, output caps, stop sequences, temperature, or future request controls to drift.

**Freeze messages across recovery.** A plugin may durably change the visible session surface during recovery. Dispatching an earlier snapshot would violate the requirement that every model-visible input is reconstructable from the current log.

**Reuse the first `PreparedLlmCall`.** Prepared calls are deliberately single-dispatch handles bound to one attempt. Reusing one would weaken their lifecycle contract and fail the second dispatch.

**Let configuration changes redirect an in-flight retry.** This is implicit provider or model failover, which has no compatibility or cost policy. Explicit route changes instead take effect at the next step and receive their own logged request header.

## Consequences

A transport recovery retains the route and explicit controls of the request that failed rather than reinterpreting them under mutable routing state. Hot replacement can still supply a new one-shot adapter registration when it accepts the frozen config. An incompatible replacement ends the turn instead of altering output limits or provider attribution within one recovery sequence.
