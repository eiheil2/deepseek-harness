# Agent Note: 取消 pi-ai 附件水合

Status: implemented

[English](2026-08-19-pi-ai-attachment-cancellation.md) | 中文

## Problem

pi-ai adapter 在转换消息历史前已经创建稳定请求信号，但图片转换调用 `AttachmentStore.readImage()` 时没有传入该信号。调用方在异步顶层或嵌套图片读取期间取消，无法让 adapter 结算。此时 provider streaming 尚未开始，其 idle watchdog 也没有启动。

## Decision

adapter 把稳定组合信号传入支持图片的 context 转换。转换会让信号穿过每一层递归工具结果并进入每次附件读取，同时在遍历前和每个 await 读取后检查取消。不带信号的转换 API 保持原有单参数 store 调用。

## Verification and boundary

修复前的 adapter 回归在阻塞的附件读取处观测到 `undefined`，并在显式释放旧路径后失败。修复后，store 收到会随调用方 abort 的信号，模型结果为 `aborted`，mock provider 没有收到请求。现有嵌套工具结果图片测试现在也证明同一信号抵达递归读取。完整 pi-ai 包通过 220 项测试；TypeScript 项目和最终修改文件 Oxlint 通过。

这让调用方取消能协作式覆盖附件水合。它不会把 provider stream idle watchdog 变成附件 deadline；不遵守协议、忽略信号的 store 仍可能拖延到读取自行返回。

## Alternatives considered

**让 provider idle watchdog 包围附件读取。** provider idle 与本地持久存储延迟属于不同预算；混用会把存储停顿错误分类为 provider 故障。

**只在转换后检查。** 这能阻止取消后的 provider I/O，却无法释放阻塞中的附件读取。

**只传原始调用方信号。** adapter 已经为请求与 consumer lifetime 拥有一个稳定组合信号；使用第二个身份会分裂取消所有权。

## Consequences

顶层和嵌套图片水合现在共享请求取消 lifetime。provider 分派前取消不再依赖附件读取自行完成。
