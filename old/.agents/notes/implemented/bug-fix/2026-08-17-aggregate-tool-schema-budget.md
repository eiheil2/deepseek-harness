# Agent Note: Aggregate tool-schema budget

Status: implemented

English | [中文](2026-08-17-aggregate-tool-schema-budget.zh.md)

## Problem

Independent tool providers and `system-prompt/assemble` listeners can grow the model-visible tool-schema array without a complete-request size limit. Per-tool validation cannot prevent the aggregate request header from becoming unexpectedly large, increasing repeated input cost or exceeding a provider's request capacity.

## Decision

`dsh-system-prompt` enforces `maxAggregateToolSchemaBytes` on the final `PromptAssembly.tools` array. The default is 262144 bytes. The measurement is the UTF-8 byte length of the array's JSON serialization and runs after the assembly waterfall and final complete-section/runtime-context constraints, where every model-visible tool is known.

An oversized assembly fails before the model request. The system does not omit schemas because presenting fewer tools than the execution registry contains requires an explicit restriction policy, and arbitrary omission could remove a capability required by the task. Deployments with a deliberately larger schema set can raise the validated positive-integer limit. The shared agent spine and ACP app declare and forward the value without redefining its default.

## Alternatives considered

**Limit each tool independently.** Many individually acceptable schemas can still exceed the complete-request budget, so a per-tool limit does not enforce the required aggregate bound.

**Check before the waterfall.** An assembly listener could add or replace tools after the check and bypass the limit.

**Silently remove schemas until the request fits.** Omission needs task-aware and execution-aligned policy. A byte-order truncation would hide capabilities unpredictably and make configuration errors appear as model failures.

**Estimate tokens instead of bytes.** Token counts vary by provider and tokenizer. The JSON byte limit gives a deterministic, provider-neutral transport guard while token and context-window accounting remain separate concerns.

## Consequences

Tool-schema growth is bounded across providers and assembly extensions, including multibyte descriptions. The exact byte boundary is deterministic across platforms. Oversized deployments fail explicitly and must restrict tools or raise the limit; the limit does not promise that every provider accepts a request of that size or that the schemas fit a model's context window.

Focused tests cover below-limit, exact-limit, aggregate overflow, multibyte text, post-waterfall additions, and invalid configuration. A keyless Headless composition pins the terminal failure before adapter dispatch.
