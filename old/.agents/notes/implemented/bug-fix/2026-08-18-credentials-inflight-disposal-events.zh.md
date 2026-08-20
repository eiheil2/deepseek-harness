# Agent Note: provider 开始 dispose 后抑制 credential 事件

Status: implemented

[English](2026-08-18-credentials-inflight-disposal-events.md) | 中文

## Problem

本地 credentials provider 会刻意排干在 service 开始 dispose 时已经进入执行的 atomic write。该写入提交后，旧实现会无条件发出 `credentials/updated`。此时 Cordis 已经从 live service 解析中移除该服务，因此 credentials invariant 会拒绝这条事件。持久写入与 provider 快照已经成功，但调用方观察到失败的 `set()`；即使未启用 invariant，事件也会逃出 provider 生命周期。

## Decision

已经进入 atomic write 的 operation 保留原有完成语义：它会到达磁盘并更新旧 provider 的内存快照。provider 在发布事件前立即检查不透明的 `closed` 状态，teardown 一旦开始就抑制事件。仍排在它后面的写入会重新检查存活状态，并在到达存储前拒绝。

## Alternatives considered

**取消正在执行的写入。** atomic replacement 可能已经越过不可逆的文件系统边界。假装可以取消，反而会让调用方与磁盘状态更难确定。

**通过 replacement credentials service 发出事件。** 已完成写入属于旧 provider 及其文档。把事件借给新服务会错误归属所有权，也可能让消费者收到关于另一存储的通知。

**把 invariant 失败当作成功。** 捕获 invariant 会掩盖真实生命周期违规，并让未来的非法事件更难诊断。阻止 dispose 后事件才能保留 invariant。

## Consequences

provider dispose 仍是事件的静止边界，同时不会丢弃已经进入 atomic commit 的写入。保留的旧 service handle 可以观察一致的完成快照，但 live consumer 不会收到来自已退出 service registry 的 owner 的事件。确定性回归会 gate 真实 atomic writer，验证磁盘与快照完成、排队后继写入拒绝、credentials invariant 启用，以及 dispose 后事件数为零。
