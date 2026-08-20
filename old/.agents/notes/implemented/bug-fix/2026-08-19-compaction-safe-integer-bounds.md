# Agent Note: Compaction policy values require safe integers

Status: implemented

English | [中文](2026-08-19-compaction-safe-integer-bounds.zh.md)

## Problem

Compaction budgets and retry counts accepted any integer-valued JavaScript number. Values above `Number.MAX_SAFE_INTEGER` lose integer precision when parsed or serialized. An unsafe `maxTokens` could reach a provider request, while unsafe retry limits could turn bounded recovery and convergence loops into impractically long work.

## Decision

`retainTokens`, `maxTokens`, `compactionRetries`, and `maxOverflowRetries` are safe integers in both the default policy and every exact-model override. The Schemastery configuration adds `Number.MAX_SAFE_INTEGER` as its inclusive maximum, and direct `resolveConfig()` validation uses `Number.isSafeInteger`. `maxTokens` remains positive; the other three values remain non-negative.

## Verification

Configuration tests reject `Number.MAX_SAFE_INTEGER + 1` for all four fields at the top level and inside `modelPolicies`, while accepting the inclusive safe-integer limit. Real Cordis plugin loading also rejects unsafe top-level and nested values through Schemastery.

## Alternatives considered

**Rely only on Schemastery.** Rejected because `resolveConfig()` is an exported parser and is called directly by tests and programmatic consumers; it must enforce the same invariant independently of Cordis normalization.

**Set smaller operational maxima.** Rejected because this defect is numerical ambiguity, not evidence for particular deployment limits. Safe-integer validation closes the precision gap without inventing unsupported policy ceilings.

## Consequences

Configuration that cannot be represented as an exact JavaScript integer now fails plugin load instead of reaching provider requests or loop counters. Very large but safe values remain accepted; practical deployment limits remain the operator's responsibility until a separately justified ceiling exists.
