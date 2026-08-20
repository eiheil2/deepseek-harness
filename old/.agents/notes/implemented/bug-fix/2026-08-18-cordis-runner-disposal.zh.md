# Agent Note：排空动态客户端 runner 的销毁流程

Status: implemented

English | [English](2026-08-18-cordis-runner-disposal.md)

## 问题

`DynamicCordisPackageRunner.dispose()` 只移除了当时位于 `live` 的插件。正在求值或等待 loader 激活的 load 可能在销毁后完成并重新写入 `live`。此外，每插件队列的 tail 在完成后永久保留，未加载过的插件 ID 会让映射无界增长。

## 决策

销毁开始时关闭准入，等待所有已准入的队列 tail，然后移除在门禁关闭后完成的条目。集成 effect 等待异步销毁。队列回收使用身份比较，防止同一插件 ID 的旧 tail 删除新操作。求值、loader 创建和激活阶段都会重新检查 disposed 状态。

## 验证与边界

runner 测试覆盖延迟的 in-flight load、销毁后的 load 拒绝、1000 个从未加载 ID 的队列回收以及正常 live 清理。本实现不取消任意插件代码，而是等待现有异步操作结束，再移除其 loader 条目和样式。

## 考虑过的替代方案

**取消正在求值的插件或 loader fiber。** runner 不拥有任意插件执行，Cordis teardown 也是异步的。关闭准入并等待现有操作，既保留 loader 所有权，也阻止晚到发布。

**保留队列 tail 供诊断。** 队列 key 是运行状态，不是持久历史。保留已完成 tail 会让从未加载的 ID 无界增长，因此采用带身份保护的回收更符合生命周期合约。

## 影响

销毁现在会等待已准入的 runner 工作，其耗时可能与该工作结束所需时间相同。销毁开始后的新 load 会失败，retract 则成为 no-op。本层不声称可以强制取消永不结束的插件。
