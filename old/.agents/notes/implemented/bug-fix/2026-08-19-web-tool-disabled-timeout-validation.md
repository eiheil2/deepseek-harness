# Agent Note: validate disabled Web tool timeouts

Status: implemented

English | [中文](2026-08-19-web-tool-disabled-timeout-validation.zh.md)

## Problem

`tool-web` validated every configured count and timeout as a positive integer before deciding which tools to register, but it did not apply Node's maximum timer range. An enabled tool eventually reached the generic `ToolDefinition.timeoutMs` validation during the same load. A disabled tool did not, so its known over-range `fetchTimeoutMs` or `searchTimeoutMs` was accepted even though the plugin otherwise validates disabled fields.

## Decision

The plugin applies `MAX_TIMER_DELAY_MS` to both timeout fields before enablement checks or registration. Defaults remain 30 seconds, and any positive integer within the host range retains its exact value.

## Verification and boundary

Regressions disable `web_fetch` or `web_search` while configuring that disabled tool to `MAX_TIMER_DELAY_MS + 1`. Both configurations fail plugin loading with the owning field name. The complete Web tool suite passes 78 tests.

The generic tool registry remains the authority for every registered definition. This check covers plugin configuration that never reaches registration because its tool is disabled.

## Alternatives considered

**Validate only enabled tools.** The plugin already rejects other invalid fields regardless of enablement. Accepting one impossible stored value would make later enablement or configuration reuse fail at a less obvious point.

**Rely only on tool registration.** That protects enabled tools but cannot validate configuration for a disabled tool.

## Consequences

Every declared Web tool timeout has one host-representable range whether or not that tool is enabled. Enablement still controls only registration and prompt visibility.
