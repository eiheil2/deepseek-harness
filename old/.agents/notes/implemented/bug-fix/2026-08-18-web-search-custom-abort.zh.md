# Agent Note：按信号状态分类 web 搜索取消

Status: implemented

中文 | [English](2026-08-18-web-search-custom-abort.md)

## 问题

Perplexity 和 Exa 搜索 provider 只有在 `fetch` 或响应体以名为 `AbortError` 的 `DOMException` 拒绝时才识别取消。Node 也可能直接以传给 `AbortController.abort(reason)` 的自定义原因为拒绝值，因此请求发送或响应体解析期间的取消会被错误呈现为 `WEB_PROVIDER_ERROR`，即使 provider 的信号已经中止。

## 决策

当操作信号已经中止，或抛出值具有标准 `AbortError` 形式时，各 provider 都把捕获到的请求或响应体读取失败分类为 `WEB_ABORTED`。对于自定义原因和平台特定的 fetch 错误，信号状态是权威依据；错误形式检查则保留对 fetch 实现在信号状态可观察前报告取消的兼容性。原始抛出值继续作为 `WebError` 的 cause。

## 验证与边界

Perplexity 和 Exa 测试覆盖请求发送、成功响应解析和错误响应解析三个阶段的自定义原因取消，同时保留标准取消和非取消网络故障用例。该决策只适用于这两个 provider 自己的操作信号；它不改变 web 工具超时预算、重试策略或 provider 响应校验。

## 考虑过的替代方案

**继续只按错误形式分类。** 这样能保留最小判定式，但会让取消语义取决于 fetch 实现和中止原因，也与 web capability 中 provider 无关的 `WEB_ABORTED` 结果冲突。

**只在工具运行时统一取消。** 直接调用 `ctx.web.search()` 的消费者仍会收到错误的 provider 故障，而且工具运行时有意允许已经启动的工具保留 provider 自己的结构化错误。因此，分类属于拥有网络操作的 provider。

## 影响

Perplexity 和 Exa 搜索会在受支持的 Node 平台以及每个等待 fetch 的阶段一致报告自定义原因取消。捕获故障时信号已经中止，则取消优先于 provider 故障，符合调用方意图。信号仍存活时的真实故障继续呈现为 `WEB_PROVIDER_ERROR`。
