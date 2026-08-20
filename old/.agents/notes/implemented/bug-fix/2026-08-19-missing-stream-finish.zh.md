# Agent Note: 缺失 LLM 流 finish 时失败关闭

Status: implemented

[英文](2026-08-19-missing-stream-finish.md) | 中文

## Problem

流式协议要求一个终止 `finish` 分片，但 `BlockAssembler.finish` 会把分片缺失当作 `{ kind: 'stop' }`。因此，适配器或 `llm/stream` 拦截器在输出部分增量后直接返回时，会把中断的响应伪装成成功。agent loop 会将这些部分内容存为已完成的 assistant 消息，压缩也可能从同类非法流中接受不完整的检查点。

## Decision

当终止分片缺失时，`BlockAssembler.finish` 现在返回 code 为 `STREAM_CLOSED` 的错误 finish。这个共享消费边界同时覆盖直接适配器与拦截器、普通 agent 轮次、压缩、会话标题和其他组装器消费方。为了诊断，内容仍可通过 `blocks()` 查看；遵守 finish 结果的消费方不会将它作为成功响应提交。

## Verification

组装器单元测试与属性测试固定了失败关闭结果。agent-loop 回归测试驱动一个仅输出部分 delta 的适配器流，并验证持久的 `STREAM_CLOSED` 轮次错误与不存在 `assistant/message`。现有 DeepSeek、pi-ai、max-token 续聊、压缩、运行时上下文与 system-prompt 测试覆盖了合法终止流。

## Alternatives considered

**仅在每个已发布适配器内强制。** 两个已发布适配器已会拒绝各自缺少终止标记的情况，但这无法保护第三方适配器或短路 `llm/stream` 拦截器。共享组装器是当前每个消费方使用的第一个共同边界。

**在组装器内丢弃部分块。** 未采用，因为 finish 分类已足以防止成功提交，保留块仍有利于诊断，且不需要另行创建一套内容保留规则。

## Consequences

非法流不再成为成功历史或压缩检查点。之前依赖“省略 `finish` 即视为 `stop`”的自定义消费方必须发出协议要求的终止分片。稳定 code `STREAM_CLOSED` 可将该协议故障与 provider 声明的 stop 或输出 token 上限区分开。
