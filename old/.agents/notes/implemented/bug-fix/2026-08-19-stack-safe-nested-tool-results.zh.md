# Agent Note: 无递归地遍历嵌套工具结果

Status: implemented

[English](2026-08-19-stack-safe-nested-tool-results.md) | 中文

## Problem

图片检测和 pi-ai 请求转换曾通过递归遍历嵌套 `tool-result` 内容。包含足够深合法内容的会话可以成功恢复，却会在 provider 分派前的请求构造阶段以 `RangeError: Maximum call stack size exceeded` 失败。

## Decision

共享的 `contentHasImage()` 辅助函数以及 pi-ai 的文本和图片转换改用显式深度优先栈。图片转换保留逐 frame 输出，因此嵌套文本分组、图片顺序、附件读取和取消检查维持原有语义。

## Verification and boundary

回归测试通过 `Session.fromRestore()` 恢复 12,000 层嵌套工具结果，并转换文本和图片叶节点。纯文本转换无需附件 store 即可成功；没有所需 store 的图片转换会拒绝；使用 store 时只读取一次唯一图片。完整 LLM 与 pi-ai 套件通过 428 项测试，恢复历史、LLM 与 Session 定向套件通过 286 项测试。

该修复覆盖持久化恢复历史和 adapter 请求转换。实时 `createMessage()` 仍把克隆交给 Node 的 `structuredClone()`；等深的新建值可能在抵达这些遍历前被它拒绝。

## Alternatives considered

**设置嵌套深度上限。** 现有 Session 或内容协议没有声明这项限制，持久化数据恢复也已经支持这种结构。只在一个 adapter 中拒绝会制造 provider 特有的历史限制。

**捕获 `RangeError` 并返回 `UNSUPPORTED_CONTENT`。** 这会把遍历实现限制伪装成内容能力失败，而且无法保护共享图片检测器的其他消费方。

## Consequences

嵌套工具结果深度不再决定请求转换的调用栈用量。遍历内存随待处理内容和活跃图片转换 frame 线性增长。
