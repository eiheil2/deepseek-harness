# Agent Note: Repointed models drop foreign protocol metadata

Status: implemented

English | [中文](2026-08-19-pi-ai-foreign-protocol-metadata.zh.md)

## Problem

A catalog model repointed through route-level `api` retained the installed descriptor's protocol-specific metadata. A DeepSeek Chat Completions model moved to OpenAI Responses kept `compat.supportsDeveloperRole: false`, causing a reasoning system instruction to use the `system` role instead of `developer`. A Google model moved to Responses kept uppercase Google `thinkingLevelMap` spellings, causing Responses to receive `HIGH` instead of its native `high` effort.

## Decision

Model resolution inherits the complete installed descriptor when its protocol matches the resolved route. When the protocol changes, resolution removes installed `compat` behavior and normalizes `thinkingLevelMap`: `null` entries continue to exclude unsupported levels, supported base levels fall back to target-protocol spellings, and supported `xhigh` or `max` levels receive identity values because pi-ai treats their absence as unsupported. Protocol-independent catalog data such as reasoning capability, capacities, modalities, cost, and display name continue to inherit. An explicit `reasoningEfforts` declaration builds a complete target-protocol map after that isolation.

## Verification

Descriptor regressions repoint installed DeepSeek and Google models to OpenAI Responses and verify that foreign behavior is absent while Gemini still offers only `low` and `high`, and DeepSeek retains its protocol-neutral `max` capability. Wire regressions verify the Responses-native `developer` system role and lowercase `high` reasoning effort. Existing same-protocol compatibility tests continue to pin normal inheritance.

## Alternatives considered

**Retain every installed descriptor field.** Rejected because protocol-specific fields can change wire semantics after `api` selects a different translator.

**Enumerate every safe catalog field.** Rejected because pi-ai can add protocol-independent model metadata that the harness does not model, and enumeration would silently discard it during upgrades.

**Translate known metadata between protocols.** Rejected because compatibility maps and reasoning spellings are implementation-specific; an inferred mapping would claim provider behavior the deployment did not configure.

## Consequences

Route-level protocol migration starts from the target protocol's request defaults while retaining catalog capability exclusions and extended-level availability. A deployment that needs non-default target behavior declares target reasoning efforts or uses an explicit surface supported by that protocol.
