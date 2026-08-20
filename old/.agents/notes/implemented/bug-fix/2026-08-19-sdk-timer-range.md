# Agent Note: validate SDK timer ranges before side effects

Status: implemented

English | [中文](2026-08-19-sdk-timer-range.zh.md)

## Problem

The TypeScript SDK accepted arbitrary numbers for request, shutdown, EOF, and termination timeouts. Node clamps a delay above `2147483647` ms to approximately one millisecond and also treats other invalid values inconsistently. A caller could therefore configure a very long request or shutdown window and receive an almost immediate timeout instead. The exported process-disposal helper could touch stdin and signal the child before exposing the bad configuration.

## Decision

The SDK imports the repository's shared `MAX_TIMER_DELAY_MS` and validates every configured timer in the `HarnessClient` constructor. A per-call request override is validated before lazy process startup. The direct disposal API validates both grace periods before inspecting or touching the child. Values must be positive and finite and cannot exceed the host timer maximum; invalid input throws rather than being clamped.

## Verification and boundary

Pre-repair regressions produced Node `TimeoutOverflowWarning` messages and seven failures. After the repair, constructor fields, the per-call override, and both disposal graces fail before their respective side effects, while existing request timeout and POSIX/Windows disposal-ladder cases retain their behavior.

This validates timer representability, not whether a deployment chose an operationally sensible duration. Fractional positive delays remain representable and accepted, matching the shared timeout utility.

## Alternatives considered

**Clamp to the maximum.** That hides invalid configuration and changes the caller's requested semantics.

**Validate only when a timer is armed.** The runtime process or child teardown could already have started, making configuration failure stateful.

**Use a package-local numeric literal.** Importing the shared constant keeps every timer-owning package on the same host boundary.

## Consequences

SDK timer configuration fails deterministically before subprocess side effects. The SDK client now has a runtime peer dependency on `@deepseek-ai/dsh-timeout` and its workspace lockfile edge records that dependency.
