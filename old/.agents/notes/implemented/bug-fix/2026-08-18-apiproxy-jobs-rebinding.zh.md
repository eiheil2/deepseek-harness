# Agent Note：随 provider 重绑定 API proxy 的 Jobs 监听器

Status: implemented

English | [English](2026-08-18-apiproxy-jobs-rebinding.md)

## 问题

原 Jobs carrier 在 mux 打开时捕获 registry。之后注入的 registry 或替换后的 registry 不会被该 mux 观察。如果绑定替换 registry 时不保存旧监听器 disposer，provider 销毁后仍会保留其回调。

## 决策

API proxy 通过注入服务绑定当前 registry，并向所有打开的 mux 发布变化。启动时的绑定覆盖注入尚未激活就打开 mux 的情况。每个绑定都保存 disposer，在 provider 替换或根 context 销毁时移除；替换销毁时先清空客户端镜像，再让旧 registry 消失。

## 验证与边界

Jobs carrier 测试通过 13 项，其中包括 mux 创建后 registry 出现、替换 registry 的任务投递，以及 replacement 恢复出的任务集合在绑定后不再变化的路径。carrier 仍发布完整集合快照，不消费 job output cursor。本修复不改变任务所有权或持久化语义。

## 考虑过的替代方案

**每个 mux 保留一个监听器，并在每次事件时重新读取 registry。** 这无法观察 mux 打开时尚不存在的 registry，也会在每条 stream 重复生命周期清理。provider 级监听器让替换只有一个所有权点，并向当前 mux 广播。

**把 registry 替换当成客户端重连。** 重连会丢失已打开的事件流，并把 provider 交换暴露为传输故障。carrier 现在清空镜像后继续使用现有 mux。

## 影响

打开的 mux 现在会跟随晚到和替换后的 Jobs provider。provider 替换会先发送空镜像，再发送 replacement 的当前任务，监听器销毁同时绑定到 provider 和根 context。绑定可能重复 boot listener 已发出的当前完整集合快照；消费者把每帧都视为权威状态。输出与持久化行为不变。
