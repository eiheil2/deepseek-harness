# Agent Note: 校验已禁用 Web 工具的超时

Status: implemented

[English](2026-08-19-web-tool-disabled-timeout-validation.md) | 中文

## Problem

`tool-web` 在决定注册哪些工具前，会把每个已配置数量和超时校验为正整数，却没有应用 Node 的最大定时器范围。启用的工具会在同一次加载期间最终抵达通用 `ToolDefinition.timeoutMs` 校验；禁用的工具不会，因此其已知超出范围的 `fetchTimeoutMs` 或 `searchTimeoutMs` 会被接受，尽管该插件会校验其他禁用字段。

## Decision

插件会在 enablement 检查或注册前，对两个超时字段应用 `MAX_TIMER_DELAY_MS`。默认值仍为 30 秒，主机范围内的任意正整数仍保留精确值。

## Verification and boundary

回归测试分别禁用 `web_fetch` 或 `web_search`，同时把被禁用工具的配置设为 `MAX_TIMER_DELAY_MS + 1`。两项配置都会在插件加载时以所属字段名失败。完整 Web 工具套件通过 78 项测试。

通用工具注册表仍是每个已注册定义的权威校验方。该检查覆盖因工具被禁用而永远不会抵达注册阶段的插件配置。

## Alternatives considered

**只校验启用的工具。** 插件已经无条件拒绝其他无效字段。接受一个不可能生效的存储值，会让后续启用或配置复用在更难理解的位置失败。

**只依赖工具注册。** 这能保护启用的工具，却无法校验已禁用工具的配置。

## Consequences

无论 Web 工具是否启用，每个已声明超时都使用同一主机可表示范围。enablement 仍只控制注册和提示词可见性。
