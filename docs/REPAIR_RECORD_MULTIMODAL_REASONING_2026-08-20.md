# 多模态、思考强度与 RC8 修复记录

日期：2026-08-20
分支：`integrate/rc8-diagnostics`
主要修复提交：`32449676f2`（`fix: complete rc8 diagnostics repair batch`）

本文件记录本轮 DSH RC8 诊断和修复的工程事实。`已实现`表示代码已经落地，`已验证`只表示有对应的测试或运行证据，`未验证`表示尚未有该类证据；不能把声明、静态检查或单元测试等同于真实第三方端点的成功调用。

## 1. 范围和证据层级

本轮覆盖 RC8 原有多模态/模型适配能力，以及 `32449676f2` 对 UI、LLM 元数据、上下文计量、缓存遥测、ACP、会话、工作区、Agent 指令预算和 Web 工具超时的修复。

上游能力实现与本轮修复必须分开归因。多模态底座主要来自 RC8 提交 `7078918b30`（DeepSeek 多模态请求）和 `4a02791c9a`（多模态审查修复）；本轮提交没有重新发明附件协议，而是把精确能力传到选择器并修补取消、动态配置等问题。

## 2. 多模态能力

### 2.1 已实现

- `attachment` / `attachment-local` 提供内容寻址的持久图片引用。写入时校验 MIME、完整图像数据、尺寸、像素和字节限制；会话日志保存引用和元数据，不保存主机路径。
- DeepSeek 适配器将已验证的图片引用在请求构造阶段读取为临时 `data:<media-type>;base64,...` 图片块；不改变持久会话消息。
- DeepSeek 适配器按路由配置 `inputModalities: [text, image]` 判断能力。文字模型或未声明模型在网络请求前拒绝图片输入。
- 单次请求图片载荷有 `maxRequestImageBytes` 上限；历史图片超限时按旧到新替换为固定占位文本，以避免请求体永久溢出。
- ACP 能把已提交的助手图片附件编码为 ACP 图片内容；本轮为读附件增加了取消信号，并使取消不必等待有序输出尾部完成。
- Host 模型目录和 RPC schema 现在传播精确模型的 `inputModalities`。
- Web 选择器显示“文字 / 文字与图片 / 未声明”。草稿含图片时，已声明为纯文字的模型不可选；能力未知不会被名称猜测强行当作视觉模型。
- 配置在运行时更新后，下一次模型解析可看到新的输入能力，无需重新注册路由。

### 2.2 已验证

代码级验证覆盖 DeepSeek/pi-ai 图片序列化和动态配置、核心内容块、ACP 图片编码与取消、选择器图片约束以及 Host/RPC 能力元数据：`llm-deepseek/tests/{adapter,serialize}.spec.ts`、`llm-pi-ai/tests/{context,dynamic-config}.spec.ts`、`llm/tests/content.spec.ts`、`acp/tests/{content,turns}.spec.ts`、`ui-model-selection/tests/model-select.client.spec.tsx`、`apiproxy/tests/{api-proxy-models,rpc-schemas}.spec.ts`。其中动态配置用例验证 `text` 改为 `text,image` 后下一次解析可见。

选择器/模型能力诊断记录了 `POST /api/llm.models` 返回 `HTTP 200`、`ok: true`、`failures: []` 的一次运行结果。该结果只证明目录和声明可被服务解析，不证明每个外部端点真的接受图片。

### 2.3 未验证和限制

- 未对每个第三方网关进行带真实图片的端到端请求；网关可能忽略或拒绝声明的图片能力。
- 能力声明是精确路由配置，不是模型名称推断，也不是自动探测。错误声明会在实际请求中暴露。
- 图片目前是输入能力；外部 URL、Files API 和助手图片输出不属于 DeepSeek 适配器的完整支持范围。
- 图片在提交后进入持久历史。若模型拒绝该图片，历史不会自动回滚；恢复方式是切换兼容视觉模型、在图片前分叉或新建会话。
- 图片预算只约束 base64 图片载荷，不包含文本、工具 schema 和 JSON 框架；部署仍需按网关请求体上限配置。

## 3. 思考强度调节

### 3.1 已实现

- 思考强度是模型级能力，不是提供方级全局开关。目录或手工 profile 的 `reasoningEfforts` 声明可用档位及其 wire 值；缺少声明时 UI 显示 `Not declared`，不猜测。
- 每次请求优先使用会话/请求指定的 `reasoningEffort`，其次使用精确模型的默认值；请求选择未声明档位会在网络 I/O 前以 `UNSUPPORTED_REASONING_EFFORT` 失败。
- DeepSeek 原生适配器支持 `off | low | high | max` 的声明和序列化：`off` 使用 `thinking.type: disabled`，启用档位使用官方 `reasoning_effort`；兼容模型的档位映射留在 pi-ai/提供方适配器内。
- pi-ai 适配器保留模型目录暴露的精确档位，不把不同档位压成同一个 wire 值；不可区分的声明会被拒绝（提交 `4870656f29`）。
- Host/API 会在模型切换、会话创建和分叉时保留或恢复正确的模型级思考强度（提交 `8c9bea7de2` 及本轮修复）。
- 选择器提供英文 `Change reasoning effort` 入口；无能力声明时该入口禁用并显示 `Not declared`，避免把“默认思考”伪装成可调档位。

### 3.2 外部模型声明的实际落地

外部模型声明依据本地模型目录、相关 agent 源码和有限 HTTP 探针，详见外部 `THINKING_EFFORT_ANALYSIS.md` 与 `MODEL_CAPABILITY_TRIAL_2026-08-20.md`。只声明探针实际接受的档位；401/403 保持未声明；DSH `low/medium/high/max` 仅是选择器词汇，wire 拼写由适配器/profile 映射，绝不以名称匹配替代 provider 声明。

### 3.3 已验证、未验证和限制

已验证：`llm-pi-ai/tests/{config,dynamic-config}.spec.ts` 共 `14 tests passed`；选择器、Host/RPC、DeepSeek 序列化/适配器对应测试覆盖入口、档位保留和 wire 映射。模型能力批次记录 `80 tests` 通过；更宽批次为 `79 passed, 1 failed`（手工 provider mock-server 超时，与本变更无关），不能宣称全套全绿。

未验证：

- 没有为所有国内或第三方模型逐档发送真实业务请求，无法证明每个档位的行为差异或成本差异。
- 不能据此断言某个模型“思考更深”，只能断言该端点接受了某个参数或适配器暴露了某个声明。

## 4. 本轮主要 Bug 修复（提交 `32449676f2`）

| 问题 | 实现 | 验证/边界 |
|---|---|---|
| 上下文容量切换后沿用旧模型压力，导致错配或负数/异常显示 | `contextPressure` 绑定 provider+model 路由；切换路由清除旧压力样本；投影对显示值做非负约束 | `packages/llm/token-meter/tests/token-usage-projection.spec.ts`；UI formatter 仍是纯函数，真实显示依赖投影事件顺序 |
| 上下文分解合计小于 provider 实际 token | Context Meter 增加“Other request overhead”余量行，避免彩色分项假装等于总量 | `context-meter.client.spec.tsx` 覆盖 111K 总量和约 16.2K 余量；provider tokenizer 差异仍是估算性质 |
| 缓存命中率在来源未知时被错误估算 | `CacheTelemetry` 引入 `available/unavailable/unknown/partial`；来源未知不显示命中率，混合来源标记 partial；DeepSeek/pi-ai 显式报告可用性（包括 0） | `token-usage-projection.spec.ts`、`chat-stats.client.spec.tsx`、`convert.spec.ts`、`translate.spec.ts`；第三方 provider 仍可能不提供缓存字段 |
| 模型目录缺少容量提示 | 从内置 catalog 取得唯一一致的 context/maxTokens hint；外部 listing 缺失字段时使用 hint | `llm-pi-ai` catalog/discovery 测试；提示不是 provider 权威容量 |
| 模型选择器看不到真实能力、可选到不兼容模型 | 传播精确 model reasoning/input metadata；无声明显示不可用；含图片草稿时禁用文字模型；动态 settings 下一次解析生效 | `model-select.client.spec.tsx`、`dynamic-config.spec.ts`、Host RPC tests；未知能力仍需真实请求确认 |
| ACP 图片输出取消时桥接卡住 | 图片读取接受 AbortSignal；连接/提示分别拥有输出取消控制器；取消在有序输出完成前结算 | `acp/tests/content.spec.ts`、`turns.spec.ts`；不等于强制中止底层文件系统所有实现 |
| 会话创建先发布后挂载工作区，失败后界面像“未创建”或重复创建 | 结构化 `SessionCreateError` 下沉到 contract；发现 `workspace-attach-failed` 时先投影 session，工作区侧恢复到 Ungrouped | 对应 runtime 服务改动和现有 session/workspace 测试；需要真实并发/崩溃场景再验证 |
| Agent 指令文件批量读取无总预算 | 增加默认 8 MiB aggregate source budget，并在 baseline/reconcile 两条路径共同执行 | `agent-instructions.spec.ts` 覆盖预算截断；预算耗尽后的用户可见提示仍取决于上层日志 |
| Web search/fetch 默认超时过短 | `DEFAULT_WEB_TOOL_TIMEOUT_MS` 从 30s 提升为 120s，仍可按 config 覆盖 | `tool-web` unit/integration tests；不修复余额不足、供应商配额或网络不可达 |

本提交还包含 ACP schema、agent instructions API catalog、DeepSeek cache translation、设置模型编辑器和相关本地化同步。上游已有但与本轮诊断相关的修复（如 reasoning content passback `583894f7ae`、compaction 后 context reproject `62312b549d`、custom web abort 分类 `6d1a78feb9`、route cache generation 隔离 `68f4b07cd4`）保持在当前 RC8 历史中，不应重复归因给 `32449676f2`。

## 5. 验证记录

- 提交前 pre-commit hook：translation pairing、staged lint、whitespace、vendor manifest guard 均通过；lint 有 4 个既有 `unused oxlint-disable` warning。
- focused LLM 配置/动态配置：`14 tests passed`。
- 模型目录/选择器诊断：记录为 `80 tests passed`；更宽批次 `79 passed, 1 failed`，失败为既有 mock-server 超时，未被本提交证明修复。
- `git diff --check`：通过（见模型能力诊断记录）。
- 本文不声称完整仓库回归通过；完整回归应在合并安装器/旧 master 归档后重新执行。

## 6. 结论

本轮已经把“模型是否支持图片”和“模型是否声明某个思考档位”从名称猜测改为精确路由能力，并在 UI、Host、LLM、ACP 之间传递；上下文、缓存和取消路径也获得了可测试的边界语义。证据足以支持“代码路径和模拟环境行为已修复”，不足以支持“所有第三方模型均真实兼容”或“缓存命中率在任何站点都可测”。后续验证优先级应是：用无敏感数据的真实图片请求逐路由测试、逐档测试已声明 effort、以及在长历史/取消/工作区并发下做黑盒回归。

## 7. 预安装器平台识别与失败恢复（2026-08-21）

Linux 安装器原先只依据 `uname -s` 和 `uname -m` 选择资产，会把原生 Android/Termux 的 `Linux/aarch64` 错判为普通 `linux-arm64`。Release 内的 Node.js 来自 Ubuntu runner，依赖 glibc，而 Termux 使用 Android Bionic；动态加载器不兼容时，即使 `runtime/node` 文件存在，shell 也会报告误导性的 `not found`。原实现还把约 100 MB 的归档放在退出即删除的临时目录，并且在 CLI 烟雾测试之前替换现有安装，因此失败重试会重复下载，失败更新也可能破坏已安装版本。

修复后的安装器在下载前验证 Linux C 库，原生 Android/Termux 或其他非 glibc Linux 会收到明确错误且不会调用归档下载器。通过 SHA-256 校验的归档保存在 `${XDG_CACHE_HOME:-$HOME/.cache}/dsh-axl`，再次执行时只获取小型 checksum 文件并重新校验缓存；可用缓存不会重复下载。新运行时先在 staging 中执行 `dsh --version`，成功后才切换安装目录，并在切换失败时恢复上一版本。

离线 WSL 回归使用伪造的 Android/Bionic 命令环境验证了“拒绝发生在下载器调用前”；使用本地微型 Release 归档验证了首次安装、删除源归档后的缓存复用，以及坏运行时烟雾测试失败后旧安装保持可用。该结果不等于新增 Android 支持；当前 Release 仍只支持列出的 Windows、glibc Linux 与 macOS 平台。

首次安装到默认 `$HOME/.local` 时，安装前已经运行的 shell 不会自动获得新创建的 `$HOME/.local/bin`，原安装器只打印模糊的 PATH 提示，因此紧接着执行 `dsh web` 会得到 `Command 'dsh' not found`。修复后，安装器会根据 `SHELL` 幂等更新 Bash、Zsh、Fish 或 POSIX profile，并打印当前终端可直接执行的精确 `export PATH=...` 命令；`DSH_NO_PATH_UPDATE=1` 可以禁止 profile 修改。离线回归验证了 profile 首次写入、重复安装不产生重复记录，以及即时激活提示存在。
