# Agent Note: traverse nested tool results without recursion

Status: implemented

English | [中文](2026-08-19-stack-safe-nested-tool-results.zh.md)

## Problem

Image detection and pi-ai request conversion recursively traversed nested `tool-result` content. A session containing sufficiently deep valid content could restore successfully and then fail request construction with `RangeError: Maximum call stack size exceeded` before provider dispatch.

## Decision

The shared `contentHasImage()` helper and pi-ai's text and image conversion use explicit depth-first stacks. The image conversion keeps frame-local output so nested text grouping, image order, attachment reads, and cancellation checks retain their existing semantics.

## Verification and boundary

A regression restores 12,000 nested tool results through `Session.fromRestore()` and converts text and image leaves. Text-only conversion succeeds without an attachment store, image conversion rejects without the required store, and conversion with a store reads the one image exactly once. The complete LLM and pi-ai suites pass 428 tests, and the focused restored-history, LLM, and Session suites pass 286 tests.

This covers durable restored history and adapter request conversion. Live `createMessage()` still delegates cloning to Node's `structuredClone()`, which may reject an equivalently deep newly constructed value before it reaches these traversals.

## Alternatives considered

**Set a nesting-depth limit.** No existing session or content contract declares such a limit, and restored durable data already supports the shape. Rejecting it in one adapter would create a provider-specific history limit.

**Catch `RangeError` and return `UNSUPPORTED_CONTENT`.** That would hide a traversal implementation limit as a content capability failure and would not protect other consumers of the shared image detector.

## Consequences

Nested tool-result depth no longer controls request-conversion stack usage. Traversal memory grows linearly with pending content and active image-conversion frames.
