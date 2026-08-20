# Agent Note: validate tool deadlines within the host timer range

Status: implemented

English | [中文](2026-08-18-tool-timeout-host-range.zh.md)

## Problem

`ToolDefinition.timeoutMs` accepted every positive finite number, while the shipped deadline primitive rejects values above the host timer maximum of `2,147,483,647` milliseconds. A tool could therefore register successfully and become visible to the model, then fail every invocation before its body ran. Configurable tools such as `web_search` exposed the same late failure when a deployment selected a larger budget.

## Decision

The typed `defineTool` helper and raw `ctx.tools.register()` boundary both validate `timeoutMs` against `MAX_TIMER_DELAY_MS` from `@deepseek-ai/dsh-timeout`. Persistent Bash applies the same maximum at both its Schemastery config and direct `apply()` boundary. Zero, negative, non-finite, and larger values fail before registration or command execution. The registry, persistent shell, and official timeout policy now accept the same interval set; values at the exact maximum remain valid.

The shared constant is imported rather than restated so a timer-range change cannot leave tool registration and enforcement with different limits. This validates declarations only; the timeout policy remains the component that arms the deadline, and tools still cooperate through `exec.signal`.

## Verification and boundary

Raw registration, `defineTool`, and persistent-Bash config tests cover the first value above the shared maximum in addition to zero and non-finite values. Existing positive-budget and persistent-command tests retain the ordinary path. The repair does not change default timeouts, add a blanket timeout to undeclared tools, or make cooperative cancellation a hard kill.

## Alternatives considered

**Reject only when the timeout policy executes.** This preserves the old registry contract but leaves an invalid tool visible and turns a deployment error into a repeated model-facing call failure.

**Validate only the web tools.** This closes the reported configuration path but leaves every other extensible tool plugin able to publish the same invalid declaration.

**Clamp to the host maximum.** Silent clamping changes the deployment's stated deadline and can conceal a unit error. Registration rejects the unsupported value instead.

## Consequences

Invalid tool deadlines fail at the earliest shared declaration boundary, with one portable upper limit owned by the timeout library. `dsh-tools` gains a dependency on the zero-state `dsh-timeout` utility, and persistent Bash imports the same constant for its config boundary, so registration and enforcement cannot drift.
