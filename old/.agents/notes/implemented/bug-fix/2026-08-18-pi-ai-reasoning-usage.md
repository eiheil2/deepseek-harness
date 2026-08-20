# Agent Note: preserve pi-ai reasoning usage

Status: implemented

English | [中文](2026-08-18-pi-ai-reasoning-usage.zh.md)

## Problem

The pi-ai adapter mapped input, output, and cache usage but dropped the optional `Usage.reasoning` field. pi-ai providers that expose a reasoning breakdown therefore lost it at the Harness seam even though `TokenUsage` supports `reasoningTokens`.

## Decision

The adapter maps an explicitly present pi-ai `reasoning` value to Harness `reasoningTokens`, including zero, and omits the Harness field only when pi-ai omits its field. pi-ai defines reasoning as a subset of output, so `outputTokens` stays unchanged and no total adds reasoning a second time.

## Verification and boundary

The conversion suite covers positive, zero, and absent reasoning values. The installed pi-ai implementation supplies the field for Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses; the OpenAI protocol adapters report zero when a response has no positive reasoning count. This change preserves pi-ai telemetry; it does not estimate reasoning usage for providers that omit it.

## Alternatives considered

**Keep only aggregate output.** This matches older pi-ai behavior but discards telemetry now exposed by the SDK and makes the pi-ai adapter less informative than the native DeepSeek adapter.

**Emit reasoning only when positive.** This would make a pi-ai-reported zero indistinguishable from a provider route for which pi-ai did not report a breakdown. Presence is meaningful telemetry, so the adapter preserves zero.

## Consequences

Consumers can display and persist pi-ai reasoning-token telemetry when available. Existing output totals and billing projections remain unchanged because reasoning is descriptive detail within output rather than an additional token bucket.
