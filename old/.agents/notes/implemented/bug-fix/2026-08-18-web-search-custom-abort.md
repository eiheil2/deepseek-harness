# Agent Note: classify web search cancellation by signal state

Status: implemented

English | [中文](2026-08-18-web-search-custom-abort.zh.md)

## Problem

The Perplexity and Exa search providers recognized cancellation only when `fetch` or a response body rejected with a `DOMException` named `AbortError`. Node may instead reject with the custom reason passed to `AbortController.abort(reason)`, so cancellation during request dispatch or body parsing surfaced as `WEB_PROVIDER_ERROR` even though the provider's signal was aborted.

## Decision

Each provider classifies a caught request or body-read failure as `WEB_ABORTED` when its operation signal is aborted or the thrown value has the standard `AbortError` form. The signal state is authoritative for custom reasons and platform-specific fetch errors; the error-form check retains compatibility when a fetch implementation reports cancellation before signal state is observable. The original thrown value remains the `WebError` cause.

## Verification and boundary

The Perplexity and Exa suites cover custom-reason cancellation at request dispatch, successful-response parsing, and error-response parsing, alongside existing standard-abort and non-abort network failures. This decision applies to these two providers' own operation signals; it does not change web-tool timeout budgets, retry policy, or provider response validation.

## Alternatives considered

**Keep error-form-only classification.** This preserves the smallest predicate but makes cancellation semantics depend on the fetch implementation and abort reason. It also contradicts the web capability's provider-neutral `WEB_ABORTED` result.

**Normalize cancellation only in the tool runtime.** Direct `ctx.web.search()` consumers would still receive the wrong provider error, and the tool runtime intentionally allows a started tool to retain a provider-owned structured error. Classification therefore belongs in the provider that owns the network operation.

## Consequences

Perplexity and Exa searches report custom-reason cancellation consistently across supported Node platforms and at every awaited fetch boundary. A signal that is already aborted when a caught failure is classified makes cancellation win over the provider failure, matching caller intent. Genuine failures with a live signal continue to surface as `WEB_PROVIDER_ERROR`.
