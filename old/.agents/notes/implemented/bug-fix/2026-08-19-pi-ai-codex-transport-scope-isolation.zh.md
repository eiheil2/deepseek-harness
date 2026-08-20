# Agent Note: pi-ai Codex 传输状态使用带认证身份的请求作用域

Status: implemented

[English](2026-08-19-pi-ai-codex-transport-scope-isolation.md) | 中文

## Problem

pi-ai 的 Codex Responses 实现只以 SDK `sessionId` 为键，缓存进程内 WebSocket 连接、其 SSE 回退决定和响应续接状态。若原样传递持久的 Harness session id，同一会话在提供方路由、模型、端点、配置、标头或凭据变化后仍会复用连接和认证状态。因此，请求可能经较早端点的已认证连接发出，并继承其续接或回退状态。

## Decision

只有同时具备 Harness session id 和显式已解析凭据的请求，适配器才会向 pi-ai 提供不透明的 SDK 会话作用域 id。进程随机密钥为 HMAC 提供密钥，HMAC 输入包含 Harness session、提供方路由、模型 id、模型 API、模型端点、路由本地缓存代次、排序后的有效请求标头和凭据。固定长度的结果低于 pi-ai 对 `sessionId` 的 64 字符限制；相同作用域在同一进程内保持稳定，且不会向提供方暴露任何作用域输入。同一个带作用域值覆盖每种协议面向提供方的缓存或会话亲和元数据；Codex 的连接与续接缓存是已复现的高影响实例。

每条提供方路由都会比较其缓存相关 profile 与模型 descriptor 的稳定指纹，只有该指纹变化时才改变该路由的不透明代次。路由代次只保存在当前不可变 snapshot 中；移除路由会丢弃其作用域，因此重新添加同一路由时也会取得新的代次，不会恢复旧的 SDK 状态，同时不会积累无界历史映射。替换或编辑其他路由不会阻止本路由复用 pi-ai 传输状态。本目标路由的端点、提供方、模型、标头或凭据变化同样会生成另一个 id，使 WebSocket 复用、SSE 回退和 `previous_response_id` 续接保持在同一个带认证身份的请求作用域内。

没有 Harness session id 的请求继续省略 SDK id。使用提供方原生 ambient credential 发现的请求也会省略它：适配器无法识别 pi-ai 内部最终选择的凭据，因此无法证明两次调用共享认证上下文。这些调用保留普通请求行为，但不共享 pi-ai 的会话亲和或缓存，包括 Codex 的持久传输与续接状态。

## Verification

纯作用域测试固定相同输入得到确定性输出、长度上限、原始作用域值不外泄、每个作用域字段彼此隔离，以及 ambient credential 时省略。Fake WebSocket 集成测试固定同作用域复用连接、端点／profile 或凭据变化后建立新连接、路由移除再添加、新作用域不携带旧 `previous_response_id`，以及不受较早作用域 SSE 回退状态影响。包内既有适配器与回放测试在无网络条件下覆盖未改变的非 Codex 行为。

## Alternatives considered

**原样转发 Harness session id。** 不予采用，因为持久会话身份无法标识 pi-ai 在其下缓存的提供方连接、端点、配置、标头、模型或凭据。

**用普通 SHA-256 哈希凭据。** 不予采用，因为提供方可见的无盐凭据摘要会向观察者提供离线测试候选凭据的 oracle。使用进程密钥的 HMAC 使已发送 id 无法用于这种攻击，并有意阻止跨进程重启复用。

**从作用域省略凭据身份，并复用 ambient authentication 会话。** 不予采用，因为 pi-ai 在适配器外部解析该凭据。把未知身份视为稳定会重新引入本次修复要关闭的跨认证缺陷。

**对所有请求禁用 SDK session id。** 不予采用，因为显式凭据已提供足以安全隔离复用的身份；完全移除持久性会在适配器能够证明作用域时仍丢失连接与续接效率。

## Consequences

同一 Harness 会话中的 pi-ai 会话亲和与缓存不再跨越路由、模型、端点、配置、标头或显式凭据变化。路由移除再添加也不能恢复旧的 SDK 状态，且路由历史不会无界累积。稳定且显式认证的请求保留进程内缓存复用，包括 Codex 的连接与续接复用。进程重启会有意生成新 id，ambient authentication 请求则放弃跨调用复用；这两项代价分别来自凭据材料不可被外部验证，以及未知凭据不得共享的安全要求。
