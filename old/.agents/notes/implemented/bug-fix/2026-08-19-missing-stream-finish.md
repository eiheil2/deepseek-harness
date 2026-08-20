# Agent Note: Missing LLM stream finish fails closed

Status: implemented

English | [中文](2026-08-19-missing-stream-finish.zh.md)

## Problem

The streaming contract requires one terminal `finish` chunk, but `BlockAssembler.finish` treated an absent chunk as `{ kind: 'stop' }`. An adapter or `llm/stream` interceptor that returned after partial deltas could therefore make an interrupted response look successful. The agent loop stored that partial content as a completed assistant message, and compaction could accept an incomplete checkpoint from the same malformed stream.

## Decision

`BlockAssembler.finish` now returns an error finish with code `STREAM_CLOSED` when no terminal chunk arrived. This shared consumer boundary covers direct adapters and interceptors, ordinary agent turns, compaction, session titles, and other assembler users. Content remains inspectable through `blocks()` for diagnostics, but consumers that obey the finish reason do not commit it as a successful response.

## Verification

Assembler unit and property tests pin the fail-closed result. An agent-loop regression drives a partial delta-only adapter stream and verifies a durable `STREAM_CLOSED` turn error with no `assistant/message`. Existing DeepSeek, pi-ai, max-token continuation, compaction, runtime-context, and system-prompt tests cover valid terminal streams.

## Alternatives considered

**Enforce only inside each shipping adapter.** Both shipping adapters already reject their own missing terminal markers, but that does not protect third-party adapters or a short-circuiting `llm/stream` interceptor. The shared assembler is the first boundary every current consumer uses.

**Discard partial blocks inside the assembler.** Rejected because the finish classification is sufficient to prevent successful commit, while retaining blocks remains useful for diagnostics and does not invent a second content-retention rule.

## Consequences

Malformed streams no longer become successful history or compacted checkpoints. A custom consumer that previously relied on an omitted `finish` being treated as `stop` must emit the required terminal chunk. The stable `STREAM_CLOSED` code distinguishes this protocol failure from a provider-declared stop or output-token limit.
