# Agent Note: cancel ACP output reads at owned teardown boundaries

Status: implemented

English | [中文](2026-08-18-acp-output-read-cancellation.zh.md)

## Problem

The ACP bridge awaited ordered assistant image conversion during prompt cancellation, client disconnect, and plugin disposal, but it called `AttachmentStore.readImage()` without the cancellation signal that service accepts. A slow or stuck attachment backend could therefore prevent the prompt and the whole connection from reaching quiescence after their owner had cancelled them.

## Decision

Each ACP session owns one output cancellation lifetime for committed output outside a live prompt, and each admitted prompt owns a separate output cancellation lifetime. Assistant image conversion receives the matching signal and forwards it to the attachment store. Prompt cancellation aborts its admission and output lifetimes; connection teardown aborts every session and prompt output lifetime before waiting for ordered delivery.

Cancellation remains distinct from attachment corruption. Conversion preserves an aborted signal's reason, and the ordered delivery chain treats an owner-requested abort as expected settlement rather than recording an output failure or warning. Non-cancellation read failures still fail the owning prompt and remain logged.

## Verification and boundary

The ACP connection suite holds an assistant attachment read after a committed image, disposes the bridge, and proves that the store received an aborted signal, the prompt settled as cancelled, and the Agent was removed. Existing output-order, missing-attachment, and explicit drain tests keep their prior behavior.

This change cancels attachment reads because their service contract accepts `AbortSignal`. It does not claim that ACP transport writes are cancellable; the ACP SDK owns those promises, which still must settle before teardown completes.

## Alternatives considered

**Wait indefinitely for every output read.** This retained ordering but violated the teardown obligation once an owned backend operation exposed cancellation.

**Reuse the admission controller for output.** Admission and delivery have different settlement points. Separate controllers make their ownership explicit and avoid changing admission semantics after the user message is queued.

**Abort one session-wide controller on prompt cancellation.** That would also disable output from later prompts in the same session. A prompt lifetime cancels only its correlated output, while the session lifetime remains available for uncorrelated committed messages.

## Consequences

Prompt cancellation and connection teardown can release a cancellable attachment read instead of waiting for backend completion. Ordered delivery and non-cancellation failure reporting remain unchanged. Each live ACP session and prompt owns one additional `AbortController`.
