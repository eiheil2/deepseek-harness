# Agent Note: cancel pi-ai attachment hydration

Status: implemented

English | [中文](2026-08-19-pi-ai-attachment-cancellation.zh.md)

## Problem

The pi-ai adapter created a stable request signal before converting message history, but image conversion called `AttachmentStore.readImage()` without it. Caller cancellation during an asynchronous top-level or nested image read could not settle the adapter. Provider streaming had not started yet, so its idle watchdog was not armed either.

## Decision

The adapter passes its stable combined signal into image-aware context conversion. Conversion forwards the signal through every recursive tool-result level and into each attachment read, checking cancellation before traversal and after each awaited read. The no-signal conversion API preserves its prior single-argument store call.

## Verification and boundary

The pre-repair adapter regression observed `undefined` at a blocked attachment read and failed after explicitly releasing that old path. After repair, the store receives a signal that aborts with the caller, the model result is `aborted`, and the mock provider receives no request. The existing nested tool-result image test now proves the same signal reaches its recursive read. The complete pi-ai package passes 220 tests; its TypeScript project and final changed-file Oxlint pass.

This makes caller cancellation cooperative across attachment hydration. It does not turn the provider stream idle watchdog into an attachment deadline, and a nonconforming store that ignores its signal can still delay until its read returns.

## Alternatives considered

**Arm the provider idle watchdog around attachment reads.** Provider idle time and local durable-storage latency are different budgets; conflating them would misclassify storage stalls as provider failures.

**Check only after conversion.** That prevents provider I/O after cancellation but cannot release a blocked attachment read.

**Pass only the raw caller signal.** The adapter already owns one stable combined signal for request and consumer lifetime; using a second identity would split cancellation ownership.

## Consequences

Top-level and nested image hydration now share the request cancellation lifetime. Cancellation before provider dispatch no longer depends on an attachment read completing by itself.
