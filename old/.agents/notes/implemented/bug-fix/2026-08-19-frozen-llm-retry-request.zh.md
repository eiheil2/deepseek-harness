# Agent Note: LLM 传输重试保留路由与控制项

Status: implemented

[英文](2026-08-19-frozen-llm-retry-request.md) | 中文

## Problem

AgentLoop 曾在可恢复的传输故障后再次运行 `agent/request` waterfall 和适配器模型解析。若路由状态或适配器默认值在退避期间变化，重试可能改用其他 provider 或 model，或者使用不同的输出 token 上限，尽管恢复的定义对象是同一个显式 provider/model 请求。

## Decision

每个 step 的第一次 attempt 会在 `agent/request` 和适配器默认值解析后冻结规范请求 header。重试复用生效配置并跳过请求 waterfall。重试仍创建新的单次 `PreparedLlmCall`，因此适配器注册生命周期和单次分发强制保持不变。适配器解析可以校验冻结的显式配置，但不能替换它；解析结果发生变化时会以 `INVALID_PREPARED_CALL` 失败，而不是静默改变请求。

消息仍会在每次分派前从当前持久 Session surface 派生。若插件在恢复期间合法追加或替换可见历史，这能维持 agent-loop 的重建不变量。失败 attempt 的 chunk 只存在于日志而不改变 surface，因此普通传输重试仍保留相同消息正文。

## Verification

agent-loop 回归测试在第一次 attempt 失败后暂停恢复，然后分别改变 `agent/request` 的 provider、model、输出上限和适配器负责的默认输出上限。两次 attempt 收到相同的 provider、model 与 `maxTokens`；waterfall 只运行一次，模型解析在每次 attempt 各运行一次，并且只记录一个请求 header。另一个恢复测试使用有效的 `sourceEventSeqs` 绑定替换持久 surface，并验证重试使用替换后的消息而不是旧消息。现有传输恢复测试覆盖持久 surface 未变化时相同的 wire body，以及通过新的 prepared call 成功恢复。

## Alternatives considered

**再次运行路由并且只拒绝 provider/model 变化。** 这仍会允许推理强度、输出上限、停止序列、temperature 或未来请求控制发生漂移。

**在恢复期间冻结消息。** 插件可能在恢复期间持久更改可见 Session surface。分派更早的快照会违反每项模型可见输入都能从当前日志重建的要求。

**复用第一个 `PreparedLlmCall`。** Prepared call 是刻意限制为单次分发、绑定单个 attempt 的句柄。复用会削弱其生命周期约定，并使第二次分发失败。

**让配置变化重定向进行中的重试。** 这属于隐式 provider 或 model 故障转移，却没有兼容性或成本策略。显式路由变化改为在下一 step 生效，并拥有自己的请求 header 日志。

## Consequences

传输恢复现在会保留失败请求的路由与显式控制项，不会在可变路由状态下重新解释它们。热替换仍可在接受冻结配置时提供新的单次适配器注册。若替换后的适配器不兼容，该 turn 会结束，不会在同一恢复序列中改变输出限制或 provider 归属。
