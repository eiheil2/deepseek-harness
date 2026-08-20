# Agent Note: 按调用身份配对工具 transcript

Status: implemented

[English](2026-08-19-tool-call-identity-pairing.md) | 中文

## Problem

compaction 过去为每个 assistant tool-call block 加一、为每个工具结果减一，以此判断工具配对边界。即使结果使用了不同的 `callId`，相同数量仍会表现为 balanced。可选 SessionInvariant 另行要求结果跟在该步骤的某个 `tool/call` 事件之后，但不会把该执行事件关联回 assistant block 身份。因此，自定义执行器或种子日志可以携带内部身份错配的 transcript，而 compaction 会把它当作安全切分位置。

## Decision

compaction 现在使用未闭合 `callId` 集合折叠当前 surface。assistant block 添加身份，结果移除同一身份。身份不匹配的结果或重复的未闭合身份属于损坏，而相互独立的结果可以按任意顺序返回。

SessionInvariant 分别跟踪 assistant 声明的身份与已开始调用。一旦步骤中出现 assistant message，每个 `tool/call` 都必须消耗一个已声明身份，合成的 not-started 结果则必须指向一个从未开始的声明。重复 assistant 身份会被拒绝。为保持兼容，没有 assistant message 的自定义或旧式步骤仍沿用原有工具调用／结果检查。

## Verification and boundary

修复前，两项聚焦回归都失败：SessionInvariant 接受 `model-call` 后接 `different-execution`，compaction 则把 `model-call` 后接结果 `different-result` 判断为 balanced。修复后两者都拒绝。重复 assistant 身份也会拒绝，而两个并行结果按反序返回仍然有效。完整 session 与 compaction 包运行通过 466 项测试；两个 TypeScript 项目和修改文件 Oxlint 通过。

这为两个所有者建立了 transcript 身份完整性。它不会让 SessionInvariant 变成强制插件，不验证工具语义，也不证明任意扩展事件都属于某个工具调用。

## Alternatives considered

**只修 SessionInvariant。** companion 是可选的，因此 compaction 仍必须独立拒绝损坏的 surface。

**只修 compaction。** 无效执行日志仍会被接受，直到后续 consumer 碰巧检查其 surface。

**按顺序配对。** 并行工具结果可以按任意顺序完成；`callId` 才是持久关系。

## Consequences

compaction 不再把相同数量误认为有效工具配对。assistant 与执行身份分歧时，规范执行日志会在更早的 invariant 边界失败，同时不会拒绝从未记录 assistant message 的旧式步骤。
