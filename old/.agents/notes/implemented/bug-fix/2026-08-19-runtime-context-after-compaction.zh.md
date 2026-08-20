# Agent Note: 在 pre-step 压缩后投影 runtime context

Status: implemented

[English](2026-08-19-runtime-context-after-compaction.md) | 中文

## Problem

agent loop 在进入 `agent/pre-step` waterfall 前就决定是否追加 runtime-context 快照。自动压缩在该 waterfall 内运行，并可能在调用 `next()` 前替换已保留快照。若渲染出的 context 文本没有变化，提前投影会返回空；随后压缩移除了已保留快照，但同一次请求不会重新计算。runtime context 直到下一次请求才恢复。

这会影响 sandbox context 等模型可见的动态策略。执行沙盒仍然强制生效，因此缺陷属于上下文完整性，而不是权限绕过。

## Decision

system-prompt assembly 和 context 渲染仍位于 `agent/pre-step` 之前。runtime-context 投影移到 waterfall 的默认 `next()` 回调。执行压缩或其他 session surface 替换的插件在继续前会先提交变化，然后投影才决定是否需要新快照。

## Verification and boundary

真实 AgentLoop 回归先保留一份未变化的 runtime context，再在下一次 `agent/pre-step` 内、调用 `next()` 前提交 compaction-shaped replacement。同一次模型请求现在会在历史尾部恰好包含一条新的 runtime-context 消息。完整 agent-loop 包通过 332 项测试，TypeScript 项目、修改文件 Oxlint 和 `git diff --check` 通过。

本修复不改变 system-prompt assembly 顺序，也不会把 runtime context 暴露到公开 pre-step payload。刻意不调用 `next()` 而直接短路的监听器仍完整拥有自己的 decision。

## Alternatives considered

**只在 compaction-basic 中重算。** 其他 pre-step 插件也能执行等价的权威 surface replacement，因此必须由投影所有者封闭竞态。

**在 waterfall 前后都投影。** 这会重复状态决策，并可能追加两份快照。

**推迟全部 system-prompt assembly。** 此处 assembly 并未过期；pre-step 中变化的只有 retained projection 状态。

## Consequences

runtime context 现在会在所有 pre-`next()` surface 修改后派生。同一步压缩不再制造一次请求的策略描述缺口，同时正常的未变化 context 去重保持不变。
