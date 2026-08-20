# Agent Note: 保留带警告的 ripgrep 部分结果

Status: implemented

[English](2026-08-19-ripgrep-partial-results.md) | 中文

## Problem

即使另一个目标已经产生有效 stdout，ripgrep 在遍历或目标错误时仍会以 2 退出。搜索工具在解析 stdout 前把所有大于 1 的退出值都视为失败，因此一个缺失或不可读路径会丢弃有效的 `glob` 路径或 `grep` 匹配。

## Decision

只有 stdout 非空、完整，且 stderr 诊断不是正则或 glob 语法错误时，退出 2 的运行才可以越过 subprocess 边界。所属工具随后解析 transport，且仅在至少保留一个真实路径或匹配时接受结果。被接受的规范值携带可选 warning，Native 输出追加有界 stderr 诊断。空输出、仅 summary、格式错误或 lossy 输出仍使用既有结构化错误词汇失败。

## Verification and boundary

单元回归覆盖部分 `glob` 和 `grep` 结果、语法错误、空失败和 lossy 的退出 2 输出。真实 ripgrep 集成套件保留既有“仅缺失目标”失败。聚焦搜索套件通过 142 项测试，另有一项平台门禁跳过。

这不声称部分结果是完整的。明确警告保留了这一区分；要求穷尽结果的调用方必须使用更窄且可访问的目标重试。

## Alternatives considered

**把所有退出 2 都视为失败。** 约定简单，但会丢失可访问目标中的有效证据。

**把任何非空 stdout 都视为成功。** `grep --json` 可能在没有匹配时仍输出 summary 记录，因此仅有 transport 不能证明存在结果。

**解析出结果后忽略 stderr。** 这会使不完整搜索看起来具有权威性。有界警告会保留在规范值和渲染文本中。

## Consequences

可访问与不可访问目标混合时，搜索会返回可用证据而不隐藏其不完整性。无效 pattern 和没有可用结果的搜索维持原有失败；截断 stdout 仍为 `SEARCH_RAW_OUTPUT_OVERFLOW`。
