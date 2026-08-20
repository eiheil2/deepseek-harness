# Agent Note: rebind API proxy job listeners with the provider

Status: implemented

English | [中文](2026-08-18-apiproxy-jobs-rebinding.zh.md)

## Problem

The Jobs carrier originally captured the registry while a mux was opened. A registry injected later, or a replacement registry, was not observed by that mux. Binding the replacement without retaining the old listener disposer would also leave provider-owned callbacks attached after teardown.

## Decision

The API proxy binds the current registry through the injected service and publishes changes through all open muxes. Boot-time binding covers a mux opened before injection activation. Every binding retains its disposer and removes it during provider replacement or root disposal; replacement teardown clears client mirrors before the old registry disappears.

## Verification and boundary

The Jobs carrier suite passes 13 tests, including registry appearance after mux creation, replacement registry delivery, and a replacement whose restored task set never mutates after binding. The carrier still publishes whole-set snapshots and does not consume job output cursors. This change does not alter job ownership or persistence semantics.

## Alternatives considered

**Keep one listener per mux and re-read the registry on every event.** This cannot observe a registry that did not exist when the mux opened and duplicates lifecycle cleanup across every stream. A provider-bound listener gives replacement one ownership point and broadcasts to current muxes.

**Treat registry replacement as a client reconnect.** Reconnecting would lose an already-open event stream and make a provider swap visible as transport failure. The carrier instead clears the mirror and continues the existing mux.

## Consequences

An open mux now follows late and replacement Jobs providers. Provider replacement emits an empty mirror before the replacement's current tasks, and listener disposal is tied to both provider and root teardown. Binding may repeat a current whole-set snapshot already emitted by the boot listener; consumers treat every frame as authoritative. Output and persistence behavior are unchanged.
