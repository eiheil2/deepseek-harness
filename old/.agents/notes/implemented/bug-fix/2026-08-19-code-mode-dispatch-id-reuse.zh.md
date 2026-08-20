# Agent Note: Code Mode 子调用 id 可承受根调用 id 复用

Status: implemented

[English](2026-08-19-code-mode-dispatch-id-reuse.md) | 中文

## Problem

Code Mode 将每个子 id 生成为 `<root>:code:<ordinal>`，而 ordinal 会在每次 `run_code` 执行时重置。提供方调用 id 可以跨 assistant step 合法复用，因此不同持久子事件可能得到相同 id，客户端投影可能错误配对子调用或更新错误的子项。

## Decision

Code Mode 桥接层在每次 `run_code` 执行第一次 await 之前分配新的 `randomUUID()` 执行命名空间，并生成 `<root>:code:<execution-namespace>:<ordinal>`。命名空间属于这次执行，而不是内存中的注册表，因此并发运行、注册表重载、进程重启以及跨 step 的提供方根 id 复用都不会重新生成同一个子 id。通用 session invariant 继续拒绝同一 assistant step 内重复的 tool-call id。

## Verification

Code Mode 回归测试使用相同根调用 id 执行两次，并断言 start 与 settle id 唯一且一一配对。客户端 fixture 使用稳定注入的 namespace 生成相同的新格式，而持久历史 replay fixture 保留既有 opaque id。完整 core tools 测试包通过。

## Alternatives considered

**拒绝所有重复的根调用 id。** 放弃，因为 session 语义会在 step 边界清除重复 id 集合，并明确允许提供方 id 跨轮次重复。

**保留确定性序号并在内存中记住已用根 id。** 放弃，因为注册表重载或进程重启会丢失历史，而长期保留所有根 id 会使长寿命进程的内存无界增长。

**从提供方根 id 派生确定性 token。** 放弃，因为根 id 本身就是碰撞输入；两次携带完全相同输入的执行无法通过确定性派生彼此区分。

**在客户端树中去重。** 放弃，因为持久事件 identity 对其他消费者与回放路径仍然含糊不清。

## Consequences

子 id 会略长且有意使用随机命名空间，但提交序号在一次执行内仍然稳定。系统不再保留注册表生命周期历史；在 UUID 碰撞模型下，命名空间跨注册表重载和进程重启仍保持唯一。
