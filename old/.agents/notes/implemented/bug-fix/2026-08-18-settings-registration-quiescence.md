# Agent Note: quiesce settings watchers with their registrant

Status: implemented

English | [中文](2026-08-18-settings-registration-quiescence.zh.md)

## Problem

A settings namespace registration belongs to the plugin fiber that created it, but disposing that fiber previously only removed the namespace map entry. An asynchronous watcher already running could settle after the registrant's disposal had completed, and queued watchers remained active. A retained scope could also add another watcher after its owner had gone away. These callbacks can touch routes, clients, or other resources that the same plugin teardown has already released.

## Decision

The registration effect now removes namespace ownership, marks every watcher inactive, clears the registration's watcher set, and awaits the captured watcher tails before its disposer settles. Marking inactive first causes queued callbacks to skip at their existing start guard; a callback already in flight is allowed to finish and is joined by disposal. `SettingsScope.watch()` rejects when either the settings service or that namespace registration has been disposed.

## Alternatives considered

**Let callbacks settle after disposal.** This keeps teardown fast but violates the registration's fiber ownership and permits post-disposal side effects against resources whose lifetime has ended.

**Cancel watcher promises.** JavaScript promises have no general cancellation contract, and a callback may already have committed external work. Waiting preserves the existing callback semantics without inventing unsafe cancellation.

**Drain only through settings service teardown.** The service already drains all started callbacks when the provider stops, but dynamic plugin replacement disposes one registrant while the provider remains alive. Service-level draining does not close that narrower lifetime.

## Consequences

Dynamic plugin teardown can wait for a slow watcher, so watcher implementations remain responsible for bounded completion. In exchange, a completed registrant disposal is a real quiescence boundary: no callback owned by that registration remains in flight and none can be added through its retained scope. Package regressions pin the pending-disposal behavior and both disposed-scope rejection paths.
