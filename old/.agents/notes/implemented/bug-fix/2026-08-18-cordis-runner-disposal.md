# Agent Note: quiesce dynamic client runner disposal

Status: implemented

English | [中文](2026-08-18-cordis-runner-disposal.zh.md)

## Problem

`DynamicCordisPackageRunner.dispose()` removed only the packages already in `live`. A load that was evaluating or waiting for loader activation could complete after disposal and repopulate `live`. Per-plugin queue tails were also retained forever after settled operations, allowing never-loaded plugin IDs to grow the map without bound.

## Decision

Disposal closes admission, waits for all admitted queue tails, and removes any entries that completed after the gate closed. The integration effect awaits asynchronous disposal. Queue cleanup uses identity comparison so an older tail cannot delete a newer operation for the same plugin ID. Evaluation, loader creation, and activation each recheck the disposed state.

## Verification and boundary

Runner tests cover delayed in-flight loading, post-disposal load rejection, settled queue reclamation for 1,000 never-loaded IDs, and normal live teardown. The implementation does not cancel arbitrary plugin code; it waits for the existing asynchronous operation to settle and then removes its loader entry and styles.

## Alternatives considered

**Cancel the evaluated plugin or loader fiber.** The runner does not own arbitrary plugin execution and Cordis teardown is asynchronous. Closing admission and waiting for the existing operation preserves loader ownership while preventing late publication.

**Leave queue tails for diagnostics.** Queue keys are operational state, not durable history. Retaining settled tails made never-loaded IDs grow without bound, so identity-guarded reclamation is the safer lifecycle contract.

## Consequences

Disposal now waits for admitted runner work and can take as long as that work takes to settle. New loads fail after disposal begins and retracts become no-ops. No claim is made that a plugin that never settles can be forcibly cancelled by this layer.
