# Agent Note: history paging follows the connection generation

Status: implemented

English | [中文](2026-08-19-history-page-resync-generation.zh.md)

## Problem

An older-page request could remain in flight while reconnect resync replaced the Session window. Resync invalidated tail opens and gap repairs but left `loadOlder()` outside that generation rule. When the old response arrived, it compared its page with the rebuilt window's new `baseSeq`, cleared `hasMore` on a mismatch, and settled the shared loading bit. A fresh page request could therefore be blocked until the old request settled or have its own loading state cleared by that settlement.

## Decision

Each older-page request captures the current open generation and `baseSeq`. It may write only while that generation is current, the Session remains open, and the window still starts at the captured sequence. Resync releases the previous generation's loading bit before opening the rebuilt window. The stale request's catch and finally paths also check generation ownership, so they neither report a dead transport failure nor settle a newer page request.

## Alternatives considered

Aborting the old RPC at transport level would save work, but paging shares the generic request path and cancellation alone would not prove that a late response cannot write. Serializing resync behind paging would preserve the stale request instead, delaying recovery and still coupling a new window to old transport state. A generation-owned commit guard is local to Session state, covers success, failure, and cleanup, and does not require a protocol change.

## Verification and boundary

The Session paging suite parks one older-page response, resyncs onto a new tail, starts a fresh older-page request, and then resolves the stale response first. The stale page cannot change the rebuilt nodes or `hasMore`, and its completion leaves the fresh request loading until that request installs its contiguous page.

This rule invalidates page reads only when the connection generation or window head changes. Live tail appends do not change `baseSeq`, so they can continue while an older page is in flight.

## Consequences

Reconnect no longer lets an obsolete history response corrupt the current window or page-control state. A page response racing a same-generation window-head replacement is discarded rather than merged against a different range; the user may request that page again from the new head.
