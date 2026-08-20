# Agent Note: pi-ai SDK 超时保持在宿主定时器范围内

Status: implemented

[English](2026-08-19-pi-ai-sdk-timeout-host-range.md) | 中文

## Problem

pi-ai profile 会依据 Node 最大定时器延迟校验 `streamIdleTimeoutMs`，却允许 `timeoutMs` 与 `websocketConnectTimeoutMs` 使用任意自然数。pi-ai 会把 WebSocket 连接值直接交给 `setTimeout`；Node 会把超过 `2,147,483,647` 毫秒的延迟钳成约一毫秒。因此，部署要求更长连接预算时可能反而几乎立即超时，不同提供方 SDK 也可能以不同方式解释过大的 HTTP 超时。

## Decision

Profile schema 校验与共享的 `resolveProfiles()` 边界只接受不超过 `MAX_TIMER_DELAY_MS` 的非负整数 `timeoutMs` 和 `websocketConnectTimeoutMs`。零仍然可用，因为 pi-ai 把它定义为这些 SDK 选项语义的一部分。`streamIdleTimeoutMs` 保留更严格的正数范围，因为 Harness 会直接启动该 watchdog。

插件加载与 settings 校验使用同一个 resolver，因此过大的 SDK 超时会在路由注册发生变化或请求到达提供方之前失败。诊断会点名提供方路由、字段和最大值。

## Alternatives considered

**把过大值钳到最大值。** 拒绝，因为静默修正会隐藏部署错误，并改变明确配置的时长。

**依赖 pi-ai 或各提供方 SDK。** 拒绝，因为 WebSocket 路径已明确让配置值进入 Node 定时器，而 HTTP SDK 并不共享一套校验规则。

## Consequences

三个 pi-ai 超时控制在所有受支持平台上都处于宿主定时器范围内。不超过精确最大值的现有配置保持行为；更大的值会使配置失败，而不会变成意外的短截止时间。

## Testing

适配器 profile 测试覆盖直接解析与插件加载的拒绝路径，并确认两个 SDK 超时字段都接受精确最大值。
