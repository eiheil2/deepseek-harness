# Agent Note: project runtime context after pre-step compaction

Status: implemented

English | [中文](2026-08-19-runtime-context-after-compaction.zh.md)

## Problem

The agent loop decided whether to append a runtime-context snapshot before entering the `agent/pre-step` waterfall. Automatic compaction runs inside that waterfall and can replace the retained snapshot before calling `next()`. When the rendered context text had not changed, the early projection returned no message; compaction then removed the retained snapshot, but the same request did not recompute the decision. Runtime context reappeared only on the following request.

This affects model-visible dynamic policy such as sandbox context. The execution sandbox remains enforced, so the defect was context completeness, not a permission bypass.

## Decision

System-prompt assembly and context rendering remain before `agent/pre-step`. The runtime-context projection now runs in the waterfall's default `next()` callback. Plugins that compact or otherwise replace the session surface before continuing therefore commit those changes before projection decides whether a fresh snapshot is needed.

## Verification and boundary

A real AgentLoop regression first retains an unchanged runtime context, then commits a compaction-shaped replacement inside the next `agent/pre-step` before calling `next()`. That same model request now contains exactly one fresh runtime-context message at the history tail. The complete agent-loop package passes 332 tests, and its TypeScript project, changed-file Oxlint, and `git diff --check` pass.

The repair does not reorder system-prompt assembly or expose runtime context in the public pre-step payload. A listener that deliberately short-circuits without calling `next()` still owns its complete decision.

## Alternatives considered

**Recompute only in compaction-basic.** Other pre-step plugins can perform an equivalent authoritative surface replacement, so the projection owner must close the race.

**Project both before and after the waterfall.** That duplicates state decisions and risks appending two snapshots.

**Delay all system-prompt assembly.** Assembly is not stale here; only retained projection state changes during pre-step.

## Consequences

Runtime context is now derived after all pre-`next()` surface mutations. Same-step compaction cannot create a one-request policy-description gap, while normal unchanged-context deduplication remains intact.
