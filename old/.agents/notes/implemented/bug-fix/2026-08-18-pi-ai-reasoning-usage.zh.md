# Agent Note：保留 pi-ai 推理 usage

Status: implemented

[English](2026-08-18-pi-ai-reasoning-usage.md) | 中文

## 问题

pi-ai 适配器映射了输入、输出和缓存 usage，却丢弃了可选的 `Usage.reasoning` 字段。因此，即使 `TokenUsage` 支持 `reasoningTokens`，提供推理明细的 pi-ai provider 在经过 Harness seam 时仍会丢失该数据。

## 决策

适配器把 pi-ai 明确存在的 `reasoning` 值映射为 Harness `reasoningTokens`，包括零；只有 pi-ai 省略该字段时，Harness 字段才会省略。pi-ai 将推理定义为输出的子集，因此 `outputTokens` 保持不变，任何总量也不会重复加上推理 token。

## 验证与边界

转换测试覆盖正数、零和缺失三种推理值。已安装的 pi-ai 实现会为 Anthropic Messages、OpenAI Chat Completions 和 OpenAI Responses 填充该字段；OpenAI 协议适配器在响应没有正数推理计数时报告零。本次变更只保留 pi-ai 遥测，不会为省略该字段的 provider 估算推理 usage。

## 考虑过的替代方案

**只保留聚合输出。** 这符合旧版 pi-ai 的行为，但会丢弃 SDK 现在公开的遥测，并使 pi-ai 适配器提供的信息少于原生 DeepSeek 适配器。

**仅在推理值为正时输出。** 这样会使 pi-ai 报告的零与 pi-ai 没有为某条 provider 路由报告明细无法区分。字段存在本身就是有意义的遥测，因此适配器保留零。

## 影响

消费者可以在数据可用时展示并持久化 pi-ai 推理 token 遥测。现有输出总量和计费投影保持不变，因为推理只是输出内部的描述性明细，而不是额外的 token 桶。
