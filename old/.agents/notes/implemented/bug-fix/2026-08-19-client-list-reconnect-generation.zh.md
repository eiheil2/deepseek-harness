# Agent Note: 客户端列表拉取按连接代次隔离

Status: implemented

[English](2026-08-19-client-list-reconnect-generation.md) | 中文

## Problem

Session 与 Workspace 列表 RPC 可能在发起它们的 WebSocket 连接代次结束后才完成。重连时会复用旧的 single-flight promise，迟到的响应或 `finally` 处理器可能安装已死亡连接的基线，或清除替代拉取，因此可见列表会保持陈旧，直到手动刷新。

## Decision

`SessionManager` 与 `WorkspaceManager` 为列表拉取维护单调代次。断连时递增代次，并清除 single-flight 引用与变更回放缓冲；底层一元请求不要求必须可取消。重连后会启动新的拉取。响应与传输错误路径只有在捕获的代次仍为当前代次时才发布状态。结算路径只有在 promise 仍是当前在途 identity 时才清理状态。`WorkspaceRuntime` 由连接所有者转发同样的断连失效操作。

## Verification

客户端回归测试挂起断连前的 RPC，断言重连后启动第二个 RPC，在替代请求仍在途时结算旧请求，并验证旧响应与结算不能替换或清除新状态。连接代次结束及 runtime 销毁时会取消 catalog debounce 定时器，旧定时器不会在断连后发起 `subagents.list`。完整 client runtime 测试包通过。

## Alternatives considered

**中止每个旧的一元请求。** 放弃，因为客户端 API 不要求每种一元实现都接受由连接所有者提供的 `AbortSignal`；代次检查无需让管理器依赖传输取消，也能保证发布安全。

**继续复用旧 promise。** 放弃，因为它描述的是已死亡连接的基线，不能证明新代次已经完成同步。

**使用墙上时钟时间戳。** 放弃，因为顺序属于生命周期而非经过时间；单调代次与 promise identity 是确定性的，也不依赖时钟精度。

## Consequences

旧请求在结算前仍可能占用传输资源，但不能修改列表状态，也不能干扰替代请求。两类列表在重连时都会进行新的基线拉取，拉取期间到达的帧仍会在其响应之上回放。runtime 销毁时也会先使两个管理器失效，再停止连接循环。
