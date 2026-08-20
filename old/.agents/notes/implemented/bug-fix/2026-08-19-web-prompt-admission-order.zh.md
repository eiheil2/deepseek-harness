# Agent Note: Web prompt 接纳保持提交顺序

Status: implemented

[English](2026-08-19-web-prompt-admission-order.md) | 中文

## Problem

每次 Web 图片提交都会先序列化浏览器文件，再调用 Session prompt 表层。后发的纯文本提交可能更早完成准备并先于图片抵达 Host。在 `File.arrayBuffer()` 期间销毁服务或释放会话作用域，也会让待处理回调继续向陈旧 SessionFace 发送 prompt。

## Decision

会话服务按 `SessionId` 串行化所有 prompt 接纳，包括 composer 的 `sendSession` 调用和插件经作用域发起的 `send` 调用。同一会话的下一项操作会在前一项结算后开始，包括前一项被拒绝的情况；不同会话使用相互独立的链。每项操作在接纳时捕获当前 sessions 服务，并在执行前验证准确的 SessionFace；图片提交会在异步文件序列化后再次验证。服务销毁与会话替换因此会在 Host prompt 分派之前被拒绝。

## Verification

客户端编排回归会挂起一次图片读取，让后发文本等待，再验证 Host prompt 顺序。独立用例证明：前序拒绝不会污染后续链，受阻会话不会阻塞另一个会话，图片序列化期间的服务销毁或会话释放不会产生 prompt。

## Alternatives considered

**只锁定 composer 状态机。** 已拒绝，因为插件可以调用公开的作用域化 `conversation.send()` 表层，而提交顺序不应取决于哪个 UI sink 发起请求。

**全局串行化所有 Web prompt。** 已拒绝，因为无关会话拥有独立的 Host 接纳，必须保持并发进度。

**让 Host 按客户端时间戳重排。** 已拒绝，因为 Host 只会收到准备完成的接纳；重建更早的浏览器本地意图会增加协议状态，也无法阻止拆除后的陈旧 SessionFace 调用。

## Consequences

较大的浏览器文件可能延迟同一会话的后续 prompt，但无法改变其顺序。其他会话仍可并发。所有者消失后，待处理图片读取会被拒绝，使既有输入事务能够恢复或释放草稿，而不会发送给陈旧目标。
