## What this repaired fork changes

This is the `eiheil2/deepseek-harness` repaired runtime based on upstream rc8. It is not the official `@deepseek-ai/dsh` npm package.

- Adds per-model text/image capability declarations and reasoning-effort controls to the model editor and selector, with runtime configuration refresh.
- Keeps image drafts compatible with model switching by disabling models explicitly declared text-only; undeclared capabilities remain unknown instead of being guessed from model names.
- Routes reasoning effort with the exact model and session across model changes, new sessions, and forks; unsupported levels fail before a network request.
- Scopes context accounting to the active provider/model route, prevents negative token displays, separates otherwise unexplained request overhead, and shows cache data only when the provider reports it.
- Fixes ACP image/output cancellation so ordered output completion cannot wait indefinitely.
- Recovers sessions whose workspace attachment failed instead of making them appear lost.
- Applies an aggregate 8 MiB default budget to Agent instruction loading and reconciliation.
- Raises the configurable default timeout for `web_search` and `web_fetch` from 30 seconds to 120 seconds.
- Adds plugin startup recovery: retry with suspected entries disabled for the process, then fall back to shipped bundles only, without uninstalling packages or rewriting the profile.
- Publishes preinstalled runtimes for Windows x64, Linux x64/arm64, and macOS x64/arm64 with bundled Node.js and resolved runtime dependencies. Installation does not run npm or pnpm.
- Detects native Android/Termux and other non-glibc Linux systems before downloading an incompatible runtime, reuses SHA-256-verified archives from a persistent cache, and tests a new runtime before replacing an existing installation.
- Configures the user's Bash, Zsh, Fish, or POSIX shell profile when the install directory is absent from `PATH`, without duplicating entries, and prints the activation command required by the already-running terminal.

These statements cover implemented and tested paths, not universal certification of every third-party gateway. Full details and evidence are in [`docs/REPAIR_RECORD_MULTIMODAL_REASONING_2026-08-20.md`](https://github.com/eiheil2/deepseek-harness/blob/master/docs/REPAIR_RECORD_MULTIMODAL_REASONING_2026-08-20.md).

## 本修复版解决的问题

这是基于官方 rc8 的 `eiheil2/deepseek-harness` 修复运行时，不是官方 `@deepseek-ai/dsh` npm 包。

- 支持在模型编辑器和选择器中按模型声明文字/图片输入能力与思考强度，并在运行时读取更新后的配置。
- 草稿含图片时禁用明确声明为纯文字的模型；未声明的能力保持“未知”，不根据模型名称猜测。
- 思考强度跟随精确模型和会话，在切换模型、新建会话与分叉时正确保留；不支持的档位会在网络请求前报错。
- 上下文计量与当前 provider/model 路由绑定，避免负数显示，单独显示无法解释的请求开销，并且仅在 provider 提供缓存数据时显示缓存信息。
- 修复 ACP 图片/输出取消后可能无限等待有序输出尾部的问题。
- 工作区挂载失败时恢复已经创建的会话，避免会话看起来丢失。
- Agent 指令首次加载与后续协调共享默认 8 MiB 总预算。
- `web_search` 与 `web_fetch` 的可配置默认超时从 30 秒提高到 120 秒。
- 增加插件启动恢复：先在当前进程禁用可疑条目重试，再退回只加载随附 bundle；不会自动卸载软件包或改写 profile。
- 发布 Windows x64、Linux x64/arm64、macOS x64/arm64 预安装运行时，捆绑 Node.js 与运行依赖，安装时不运行 npm 或 pnpm。
- 在下载不兼容运行时之前识别原生 Android/Termux 和其他非 glibc Linux；复用持久缓存中通过 SHA-256 校验的归档；新运行时通过测试后才替换现有安装。
- 安装目录不在 `PATH` 时，幂等配置用户的 Bash、Zsh、Fish 或 POSIX shell profile，并打印让当前已运行终端立即生效的激活命令。

以上说明只覆盖已经实现并测试的代码路径，不代表所有第三方网关均已认证。完整证据见 [`docs/REPAIR_RECORD_MULTIMODAL_REASONING_2026-08-20.md`](https://github.com/eiheil2/deepseek-harness/blob/master/docs/REPAIR_RECORD_MULTIMODAL_REASONING_2026-08-20.md)。
