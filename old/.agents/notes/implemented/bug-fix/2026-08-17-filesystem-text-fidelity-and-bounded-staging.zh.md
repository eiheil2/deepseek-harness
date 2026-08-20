# Agent Note: Preserve text fidelity and bound atomic staging names

Status: implemented

[English](2026-08-17-filesystem-text-fidelity-and-bounded-staging.md) | 中文

## Problem

字面量编辑在匹配前规范化 CRLF，并在恢复主要存储风格时再次规范化。源文本中紧邻 CRLF 之前的孤立回车因此会在写回时丢失一个回车。主要风格检测又只采样前 4096 个 UTF-16 code unit，所以后续行决定主要风格的长文件可能以错误风格重写。此外，本地原子暂存会在两个生成路径组件中重复完整目标 basename，使原本有效的长文件名超过文件系统组件长度限制。面向模型的读取截断也可能停在 UTF-16 代理对的高代理项之后。

## Decision

本地与 E2B 字面量编辑扫描完整的已解码编辑基准并统计 LF 与 CRLF 分隔符。恢复 CRLF 时只把已规范化的 LF 分隔符扩展一次，不再二次规范化，因此规范文本中保留的孤立回车会在恢复后继续存在。本地原子写入使用固定长度的随机暂存目录名和固定文件名 `content.tmp`，不依赖目标 basename。读取截断保留按 UTF-16 code unit 定义的配置上限；当上限落在有效代理对之间时回退一个 code unit。

## Alternatives considered

**拒绝包含紧邻 CRLF 的孤立回车的文件。** 未采用，因为字面量编辑可以在不削弱二进制或 UTF-8 校验的情况下保留这些字节，而拒绝会让有效文本文件失去编辑能力。

**规范化时用哨兵编码异常回车。** 未采用，因为直接单次恢复即可保留它们，无需引入可能与文件内容冲突的转义值。

**继续用前缀样本检测换行风格。** 未采用，因为已解码编辑基准已经驻留内存，线性扫描只增加有界 CPU 且无需额外分配；前缀无法代表主要风格在后段变化的文件。

**按 Unicode code point 而非 UTF-16 code unit 截断。** 未采用，因为公开配置和 JavaScript 字符串 API 将现有上限定义为字符形式的 UTF-16 code unit。只在代理对边界回退可以保持输出有效，同时不扩大配置上限，也不改变普通截断。

## Consequences

字面量编辑会保留相邻的孤立回车，并一致地选择完整文件的主要风格。完整扫描对已解码输入呈线性复杂度。当截断边界穿过代理对时，返回行可能比配置上限少一个 code unit。原子暂存路径增加的长度固定且与目标文件名无关，同时保留同级目录发布、排他创建、私有 mode、Windows DACL 处理和清理行为。
