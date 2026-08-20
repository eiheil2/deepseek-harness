# Agent Note: require distinguishable pi-ai reasoning efforts

Status: implemented

English | [中文](2026-08-19-pi-ai-distinguishable-reasoning-efforts.zh.md)

## Problem

Configured `reasoningEfforts` drove selector metadata independently of the resolved OpenAI-completions dialect. A profile could offer `low` and `high` while `thinkingFormat: deepseek` and `supportsReasoningEffort: false` sent both as the same `thinking: {type: "enabled"}` request. Plain OpenAI format with effort transport disabled could offer a positive level that sent no control at all. Duplicate wire spellings created the same mismatch even on a graded dialect.

## Decision

Catalog resolution validates every configured OpenAI-completions model or route-default effort declaration after model reasoning and compat have both materialized. A declaration must resolve an explicit `thinkingFormat`. OpenAI graded effort requires `supportsReasoningEffort: true`; DeepSeek, z.ai, and Together are binary unless that flag is explicitly true; Qwen is always binary; OpenRouter, Ant Ling, and string-thinking carry positive spellings directly. Other protocols retain pi-ai's reasoning behavior and require a wire spelling for every positive declared level.

A binary dialect accepts at most one positive level, written with an empty value because dispatch sends only an enable switch. Resolution gives that level an internal identity map solely so pi-ai's selector helper exposes `xhigh` and `max` consistently; the binary dispatcher never sends the marker. Graded positive levels require unique non-empty wire spellings. Off values are accepted only where the dialect sends them and cannot equal a positive spelling.

This decision partially supersedes only the [per-model reasoning declaration Note](../feature/2026-08-08-pi-ai-per-model-reasoning-declarations.md)'s rule that every positive level must carry a wire spelling. Model-level declarations, compat configuration, catalog overrides, and the rest of that decision remain current.

## Verification and boundary

Before repair, the focused regression failed because an OpenAI declaration with disabled effort transport was accepted. The independent wire capture also showed DeepSeek `low` and `high` producing byte-equivalent request controls. After repair, configuration rejects absent control, binary multi-level offers, ignored spellings, and duplicate spellings. Accepted graded DeepSeek `low` and `high` requests carry different `reasoning_effort` values; accepted binary DeepSeek uses distinct enabled and disabled requests without an effort field.

The affected catalog and adapter suites pass 104 tests; the complete llm-pi-ai package passes 224 tests. This gate validates configured OpenAI-completions `reasoningEfforts` and `defaultReasoningEfforts`; a capability inherited unchanged from pi-ai's installed catalog and non-OpenAI-completions request semantics remain pi-ai-owned evidence. Chat-template dialects remain outside the configurable surface because their kwargs are not exposed.

## Alternatives considered

**Merge indistinguishable levels in the UI.** That hides a false provider contract in one consumer while API callers and persisted selections still observe fictitious levels.

**Keep one arbitrary string value for a binary positive level.** The string is never sent, contradicting the public rule that values are wire spellings. A valueless binary level records the actual absence of an effort parameter.

**Probe the provider at runtime.** A network probe cannot prove semantic effort strength, adds credentials and side effects to configuration, and still cannot distinguish an endpoint that accepts but ignores a field.

## Consequences

Invalid effort catalogs fail where settings are resolved, before route registration or provider I/O. Existing custom declarations that relied only on URL guessing must state their thinking format; binary declarations migrate their sole positive value from a placeholder string to an empty YAML value.
