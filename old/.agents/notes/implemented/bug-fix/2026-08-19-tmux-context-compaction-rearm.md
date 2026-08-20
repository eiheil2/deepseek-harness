# Agent Note: Tmux context re-arms after compaction

Status: implemented

English | [中文](2026-08-19-tmux-context-compaction-rearm.zh.md)

## Problem

Tmux context used its latest raw durable reading for both interval scheduling and unchanged-state suppression. Compaction could shadow that reading from the model surface while the raw event continued suppressing an identical future state, leaving resumed and live sessions without any visible tmux snapshot indefinitely.

## Decision

The latest durable tmux reading carries separate time and visibility facts. Raw event time continues to control `refreshIntervalMs`, preserving one schedule across compaction and process restoration. Unchanged-state suppression applies only while that exact event remains on the current session surface. Once compaction shadows it, the next interval-eligible first step records the current state even when the pane is unchanged.

## Verification

The focused regression shadows the initial reading with a surface replacement and continues both the live Session and a Session restored from the same events. At the exact interval threshold, each path records a second durable reading while `deriveMessages()` exposes exactly one current tmux snapshot.

## Alternatives considered

**Ignore surface visibility.** Rejected because durable history and model-visible context answer different questions after compaction; one timestamp cannot prove that the model still sees the state.

**Discard shadowed event time.** Rejected because compaction would reset the refresh interval and permit an immediate query, making scheduling depend on summary timing rather than the last actual reading.

**Store process-local visibility state.** Rejected because restoration and process restarts would lose it, recreating different behavior for the same durable session.

## Consequences

Compacted sessions regain one current tmux snapshot without query bursts inside the configured interval. Raw history can contain multiple equal readings across compaction boundaries, while the current model surface contains only the latest visible one.
