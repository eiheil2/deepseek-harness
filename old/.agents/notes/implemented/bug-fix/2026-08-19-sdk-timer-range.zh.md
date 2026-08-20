# Agent Note: 在副作用前校验 SDK 计时器范围

Status: implemented

[English](2026-08-19-sdk-timer-range.md) | 中文

## Problem

TypeScript SDK 会接受任意数值作为请求、shutdown、EOF 和终止超时。Node 会把大于 `2147483647` 毫秒的延迟钳成约一毫秒，并以不一致方式处理其他无效值。因此，调用方可能配置很长的请求或关闭窗口，却得到几乎立即发生的超时。导出的进程 dispose helper 还可能在暴露错误配置前触碰 stdin 并向子进程发送信号。

## Decision

SDK 导入仓库共享的 `MAX_TIMER_DELAY_MS`，并在 `HarnessClient` 构造函数中校验每个已配置计时器。逐调用请求覆盖值会在延迟启动进程前校验。直接 dispose API 会在检查或触碰子进程前校验两个宽限期。数值必须为正且有限，并且不能超过宿主计时器上限；无效输入会抛错而不是被钳位。

## Verification and boundary

修复前回归产生 Node `TimeoutOverflowWarning`，并有七项失败。修复后，构造字段、逐调用覆盖值和两个 dispose 宽限期都会在对应副作用前失败；现有请求超时及 POSIX/Windows dispose 阶梯用例维持原有行为。

本修复校验计时器是否可表示，而不判断部署选择的时长在运维上是否合理。正的有限小数延迟仍可表示并被接受，与共享 timeout 工具一致。

## Alternatives considered

**钳到最大值。** 这会隐藏无效配置并改变调用方请求的语义。

**只在计时器启动时校验。** runtime 进程或子进程清理可能已经开始，使配置失败带上状态副作用。

**使用包内数值字面量。** 导入共享常量可让每个拥有计时器的包采用相同宿主边界。

## Consequences

SDK 计时器配置会在 subprocess 副作用前确定性失败。SDK client 现在具有对 `@deepseek-ai/dsh-timeout` 的运行时 peer dependency，workspace lockfile edge 也记录了该依赖。
