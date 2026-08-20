# Agent Note: 压缩策略值必须是安全整数

Status: implemented

[English](2026-08-19-compaction-safe-integer-bounds.md) | 中文

## Problem

压缩预算和重试次数原本接受任何值为整数的 JavaScript number。超过 `Number.MAX_SAFE_INTEGER` 的值在解析或序列化时会失去整数精度。不安全的 `maxTokens` 可能进入提供方请求，不安全的重试上限则可能使本应有界的恢复与收敛循环产生不切实际的长时间工作。

## Decision

默认策略和每个精确模型覆盖中的 `retainTokens`、`maxTokens`、`compactionRetries` 与 `maxOverflowRetries` 均为安全整数。Schemastery 配置将 `Number.MAX_SAFE_INTEGER` 设为包含端点的最大值，直接 `resolveConfig()` 校验使用 `Number.isSafeInteger`。`maxTokens` 仍须为正数，其他三个值仍须为非负数。

## Verification

配置测试验证四个字段在顶层和 `modelPolicies` 内都会拒绝 `Number.MAX_SAFE_INTEGER + 1`，同时接受包含端点的安全整数上限。真实 Cordis 插件加载还验证了 Schemastery 会拒绝顶层和嵌套的不安全值。

## Alternatives considered

**只依赖 Schemastery。** 否决，因为 `resolveConfig()` 是导出的解析器，测试和编程调用方会直接调用它；该函数必须独立于 Cordis 归一化实施同一不变式。

**设置更小的运行上限。** 否决，因为本缺陷是数值歧义，而不是特定部署上限的证据。安全整数校验无需虚构缺乏依据的策略上限即可消除精度缺口。

## Consequences

无法表示为精确 JavaScript 整数的配置现在会在插件加载时失败，不再进入提供方请求或循环计数器。非常大但安全的值仍可接受；在出现独立且充分的依据前，实际部署上限仍由操作方负责。
