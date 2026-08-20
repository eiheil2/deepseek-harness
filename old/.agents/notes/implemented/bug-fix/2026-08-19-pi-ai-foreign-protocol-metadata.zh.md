# Agent Note: 重定向模型丢弃异协议元数据

Status: implemented

[English](2026-08-19-pi-ai-foreign-protocol-metadata.md) | 中文

## Problem

通过路由级 `api` 重定向的 catalog 模型仍会保留已安装 descriptor 的协议专属元数据。迁移到 OpenAI Responses 的 DeepSeek Chat Completions 模型会保留 `compat.supportsDeveloperRole: false`，使推理系统指令使用 `system` 角色而非 `developer`。迁移到 Responses 的 Google 模型会保留大写 Google `thinkingLevelMap` 拼写，使 Responses 收到 `HIGH` 而非原生的 `high` 档位。

## Decision

当已安装 descriptor 的协议与解析后的路由一致时，模型解析会继承完整 descriptor。协议变化时，解析会移除已安装的 `compat` 行为并规范化 `thinkingLevelMap`：`null` 条目继续排除不支持的档位，受支持的基础档位回退到目标协议拼写，受支持的 `xhigh` 或 `max` 则取得恒等值，因为 pi-ai 会把它们的缺席解释为不支持。推理能力、容量、模态、成本和显示名称等与协议无关的 catalog 数据仍会继承。显式 `reasoningEfforts` 声明会在隔离之后构造完整的目标协议映射。

## Verification

Descriptor 回归把已安装的 DeepSeek 与 Google 模型重定向到 OpenAI Responses，并验证异协议行为不再残留，同时 Gemini 仍只提供 `low` 与 `high`，DeepSeek 保留协议中立的 `max` 能力。Wire 回归验证 Responses 原生的 `developer` 系统角色和小写 `high` 推理档位。既有同协议兼容性测试继续固定正常继承行为。

## Alternatives considered

**保留已安装 descriptor 的所有字段。** 已拒绝，因为 `api` 选择另一个转换器后，协议专属字段仍可能改变 wire 语义。

**枚举所有安全的 catalog 字段。** 已拒绝，因为 pi-ai 可能增加 harness 未建模、但与协议无关的模型元数据；枚举会在升级时静默丢弃它们。

**在协议之间转换已知元数据。** 已拒绝，因为兼容映射与推理拼写取决于具体实现；推断映射会声称部署并未配置的提供方行为。

## Consequences

路由级协议迁移会采用目标协议的请求默认值，同时保留 catalog 的能力排除信息与扩展档位可用性。需要非默认目标行为的部署应声明目标推理档位，或使用该协议明确支持的配置面。
