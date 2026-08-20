# Agent Note: 要求 pi-ai 推理档位可区分

Status: implemented

[English](2026-08-19-pi-ai-distinguishable-reasoning-efforts.md) | 中文

## Problem

配置的 `reasoningEfforts` 会独立于最终解析出的 OpenAI-completions 方言生成选择器元数据。一个 profile 可以同时提供 `low` 与 `high`，而 `thinkingFormat: deepseek` 配合 `supportsReasoningEffort: false` 会把两者都发送成同一个 `thinking: {type: "enabled"}` 请求。关闭档位传输的普通 OpenAI 格式甚至可以提供一个完全不发送控制字段的正向档。即使方言支持分档，重复的协议拼写也会造成同一错配。

## Decision

Catalog 解析会在模型推理能力与 compat 都完成物化后，校验每份已配置 OpenAI-completions 模型级或路由默认档位声明。声明必须解析出显式的 `thinkingFormat`。OpenAI 分档传输要求 `supportsReasoningEffort: true`；DeepSeek、z.ai 与 Together 在该标志未显式为 true 时属于二值；Qwen 始终是二值；OpenRouter、Ant Ling 与 string-thinking 直接携带正向档拼写。其他协议保留 pi-ai 的推理行为，并要求每个已声明正向档都提供协议拼写。

二值方言最多接受一个正向档，并把值留空，因为分派只发送启用开关。解析仅为该档位生成内部恒等映射，使 pi-ai 的选择器辅助函数一致公开 `xhigh` 与 `max`；二值分派器不会发送该标记。分档方言的正向档必须有唯一的非空协议拼写。Off 值只在方言实际发送它时才被接受，且不得与正向档拼写相同。

该决定仅部分取代[按模型推理声明 Note](../feature/2026-08-08-pi-ai-per-model-reasoning-declarations.md) 中「每个正向档必须携带协议拼写」这条规则。模型级声明、compat 配置、catalog 覆盖以及该决定的其余内容仍然有效。

## Verification and boundary

修复前，聚焦回归失败，因为关闭档位传输的 OpenAI 声明仍被接受。独立协议捕获还显示 DeepSeek 的 `low` 与 `high` 产生逐字节等价的请求控制。修复后，配置会拒绝缺少控制通道、二值多档、会被忽略的拼写与重复拼写。被接受的 DeepSeek 分档配置会让 `low` 与 `high` 请求携带不同的 `reasoning_effort`；被接受的 DeepSeek 二值配置则生成不同的启用和禁用请求，且不携带档位字段。

受影响的 catalog 与 adapter 测试通过 104 项；完整 llm-pi-ai 包通过 224 项测试。该门禁校验已配置 OpenAI-completions 的 `reasoningEfforts` 与 `defaultReasoningEfforts`；完全沿用 pi-ai 已安装 catalog 的能力和非 OpenAI-completions 请求语义，仍属于 pi-ai 自有证据。chat-template 方言仍不在可配置面内，因为其 kwargs 没有开放。

## Alternatives considered

**在界面合并无法区分的档位。** 这只会在一个消费方隐藏虚假的提供方契约，API 调用方与持久化选择仍会看到并不存在的档位。

**为二值正向档保留任意字符串。** 该字符串永远不会发送，违背「值就是协议拼写」的公开规则。无值二值档如实记录了档位参数的缺席。

**运行时探测提供方。** 网络探测无法证明档位的语义强度，还会把凭据与副作用引入配置过程；端点即使接受却忽略字段，探测仍无法辨别。

## Consequences

无效档位目录会在 settings 解析处失败，早于路由注册与提供方 I/O。依赖 URL 猜测的既有自定义声明必须写明思考格式；二值声明需要把唯一正向档从占位字符串迁移为空 YAML 值。
