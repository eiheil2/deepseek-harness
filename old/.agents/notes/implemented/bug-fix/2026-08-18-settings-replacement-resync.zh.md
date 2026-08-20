# Agent Note: 在飞行中持久化完成后重新同步 settings 替代注册

Status: implemented

[English](2026-08-18-settings-replacement-resync.md) | 中文

## Problem

一项 settings 写入可能在其 registrant fiber 被 dispose 前进入提供方持久化。随后，动态插件替换可在该持久化结算前为同一 namespace 建立新注册。已完成的写入会更新存储与提供方原始文档，但通知已 dispose 的注册会违反生命周期所有权；若不处理替代注册，则会同时存在两个当前值：存储包含已完成写入，而 `SettingsScope.get()` 与配置视图仍保留该写入落地前解析出的值。

## Decision

持久化提交点在发布已完成分节前读取最新的缓存原始分节。若原注册仍拥有该 namespace，则执行普通的 `update` 提交；若另一个注册已成为 owner，则用替代注册自己的 schema、组合 base 和校验钩子解析已完成分节。有效解析值会推进替代注册的原始分节 revision，并以 `provider` 为来源提交；非法值则保留替代注册的最后可用值，并采用与提供方热重载相同的告警策略。

任何通知都不会到达已 dispose 的注册。namespace 仍未注册或 settings 服务正在停止时，写入会到达存储，但不会产生消费方提交。

## Alternatives considered

**阻塞替代注册，直到旧写入排干。** `register()` 是同步且绑定 effect 的操作。让动态插件注册异步等待会把持久化时序扩散到每个注册方，并拖延无关的 HMR 设置过程。

**取消或丢弃旧写入。** `persist()` 一旦开始，提供方可能已经在外部完成提交，无法承诺取消。忽略完成结果会保留本决策要消除的存储与运行时分裂。

**把旧注册解析出的值应用给替代注册。** 替代插件可能使用不同的 schema、base 或校验规则。复用旧值会绕过当前 owner，并可能接纳它无法服务的配置。

## Consequences

动态替换会让运行时与配置视图收敛到提供方已完成的写入，同时不会复活已 dispose 的 owner。拒绝旧 owner 值的替代注册仍可按最后可用值运行，但原始文档仍包含被拒绝分节，需要后续有效编辑修正。包测试固定了成功重同步、revision 推进、`provider` 事件归因、watcher 交付与不兼容 schema 隔离。
