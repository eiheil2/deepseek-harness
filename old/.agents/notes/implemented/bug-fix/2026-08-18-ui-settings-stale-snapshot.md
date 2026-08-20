# Agent Note: reject stale settings snapshots as a whole

Status: implemented

English | [中文](2026-08-18-ui-settings-stale-snapshot.zh.md)

## Problem

`SettingsScopeController` suppressed a stale read's decoded value but still copied its revision, base, and user fields. A superseded read followed by a failed newer read could therefore publish a snapshot whose value belonged to one revision while its metadata belonged to another.

## Decision

`accept()` now returns before mutating the store when the read generation is stale. A read is published only as one candidate snapshot, so `value`, `base`, `user`, `revision`, and status remain from the same namespace view. The README contract now states that stale reads do not mutate the snapshot.

## Verification

The focused UI settings suite passes, including a deferred older read followed by a failing newer read. The regression asserts that the prior value and revision remain paired. This repair does not add retry behavior or claim that an unavailable transport can recover without a later invalidation or explicit load.

## Alternatives considered

**Publish metadata without value.** This was the existing behavior and created the mixed-revision snapshot. Metadata is part of the value's fencing contract, so publishing it alone is not coherent.

**Retry every failed read.** Retrying would change transport policy and could keep a disposed or offline scope active indefinitely. The fix only rejects stale publication and leaves recovery to the existing invalidation or explicit load paths.

## Consequences

A failed latest read leaves the last coherent snapshot untouched. A successful stale response can no longer advance revision metadata without its value. The server may have newer state than the client until a later read succeeds, which is explicit rather than a mixed local snapshot.
