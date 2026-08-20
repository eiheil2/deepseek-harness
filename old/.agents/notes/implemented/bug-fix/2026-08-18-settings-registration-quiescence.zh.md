# Agent Note: settings watcher 随注册方一起静止

Status: implemented

[English](2026-08-18-settings-registration-quiescence.md) | 中文

## Problem

settings namespace 注册属于创建它的插件 fiber，但此前 dispose 该 fiber 只会删除 namespace map 条目。已经执行的异步 watcher 可以在注册方 dispose 完成后才结算，排队中的 watcher 也仍保持 active；保留下来的 scope 还可以在 owner 消失后添加新 watcher。这些回调可能触碰同一插件 teardown 已释放的路由、客户端或其他资源。

## Decision

注册 effect 现在先移除 namespace 所有权，把每个 watcher 标为 inactive，清空注册项的 watcher 集合，并在 disposer 结算前等待捕获到的 watcher tail。先标 inactive 会让排队中的回调在既有启动守卫处跳过；已在执行的回调可以完成，并由 dispose 等待。`SettingsScope.watch()` 会在 settings 服务或该 namespace 注册已 dispose 时拒绝调用。

## Alternatives considered

**允许回调在 dispose 后结算。** 这能让 teardown 更快，但违反注册项的 fiber 所有权，并允许回调对生命周期已经结束的资源产生 dispose 后副作用。

**取消 watcher promise。** JavaScript promise 没有通用取消契约，回调也可能已经提交外部工作。等待可以保留现有回调语义，无需发明不安全的取消机制。

**只依赖 settings 服务 teardown 排干。** 提供方停止时，服务已经会排干所有已启动回调；但动态插件替换会在提供方仍存活时只 dispose 一个注册方。服务级排干无法封闭这个更窄的生命周期。

## Consequences

动态插件 teardown 可能等待慢 watcher，因此 watcher 实现仍有责任保证有界完成。作为交换，注册方 dispose 完成会成为真实的静止边界：该注册拥有的回调不再处于执行状态，也不能通过保留的 scope 新增回调。包回归固定了 dispose 保持 pending 的行为和两条 disposed-scope 拒绝路径。
