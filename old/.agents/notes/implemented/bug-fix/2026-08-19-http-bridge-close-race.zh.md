# Agent Note: 封闭 HTTP 流背压的 close 竞态

Status: implemented

[English](2026-08-19-http-bridge-close-race.md) | 中文

## Problem

Node HTTP bridge 只在 `res.write()` 返回 false 后才等待 `drain` 或 `close`。若客户端已经关闭，或 close 在该次 write 内同步发生，新监听器不会收到任何一个事件。即使请求信号已经 abort，晚到的已缓冲响应块仍可能让 `bridge()` 永久 pending。

浏览器事件下行已使用 WebSocket，但流式 `/api/session.export` 响应和扩展路由仍使用该 bridge。反复取消流可能滞留 handler、响应监听器和 body reader。

## Decision

bridge 把响应 destroyed 状态和请求 abort 信号当作可复查的状态，而不只依赖一次性事件。每次写入前都会检查。背压写入后，它先订阅 drain、close 和 abort，再复查状态，以覆盖 close 与监听注册竞态的窗口。断连会退出异步迭代并取消 WHATWG 响应体。bridge 只对仍可写的响应调用 `end()`。

## Verification and boundary

确定性假响应会在 `write()` 内同步触发 close，然后返回 false。bridge 现在会结算、只写一次、取消 body，并且不调用 `end()`。真实 `node:http` 回归在收到第一块后销毁客户端，同时 producer 稍后仍放入一个已缓冲块；bridge 会结算并取消 producer。完整 connection 包通过 110 项测试，TypeScript 项目与修改文件 Oxlint 也通过。

这是生命周期和背压正确性修复。它不宣称每个上游 producer 都会立即响应 abort，也不把该竞态归类为安全边界绕过。

## Alternatives considered

**只等待 `close`。** EventEmitter 不会向事件发生后注册的监听器重放 close。

**只依赖请求 AbortSignal。** producer 在观察到取消后仍可能产出已经缓冲的块。

**迭代后总是结束响应。** 对已销毁 socket 调用 `end()` 会混淆正常完成与客户端断连，而且没有必要。

## Consequences

正常背压仍等待 drain，正常完成仍结束响应。客户端断连现在会停止写入、释放 body iterator，并在 close 与背压写入竞态时仍结算 handler。
