# Agent Note: 插件启动安全模式

状态：已实现

[English](2026-08-20-plugin-startup-safe-mode.md) | 中文

## 问题

插件导入或激活失败可能在 Web 或终端界面可用前就拒绝整个 profile。现有 fail-loud 路径会报告失败并退出，但无法让操作者先启动 Harness 来修复问题插件。

## 决策

CLI 将 Loader 激活失败视为每次调用最多可恢复一次。第一次子进程重启保留正常 profile 组合，并根据 Loader 错误中识别出的条目追加仅内存生效的 `disabled: true` patch。若无法识别条目，或该重试仍然失败，第二次重启进入全插件恢复：只解析发行版提供的 profile bundle，并省略 profile patch、home patch 和 `--patch` 覆盖层。

恢复过程只作用于当前进程，不删除 npm 包，也不改写 profile 文件。环境输入在成为 patch id 前会经过长度和字符校验。全插件恢复失败后子进程不会继续递归重启，而是返回原始启动错误。

诊断原始快速失败路径时，可设置 `DSH_SAFE_MODE_DISABLED=1` 关闭自动恢复。

## 后果

操作者会得到一个可用的安全会话，并在 stderr 中看到疑似条目 id 和模块名。只停用问题条目的重试会保留无关插件；全插件回退只提供发行版基础能力，因此被跳过插件提供的功能在修复正常 profile 前不可用。已安装的包仍可检查，或通过显式 plugin 命令删除。

## 测试

`identifyStartupPluginFailures` 覆盖精确条目匹配和非插件 patch 错误。`loadProfile(..., { bundles })` 覆盖只解析允许的 bundle、而不导入被跳过的损坏 bundle。built-bin 子进程夹具证明：失败条目会被报告并停用，无关健康条目能进入运行态，恢复进程可正常关闭，且 profile manifest 与 patch 字节完全不变。既有快速失败 E2E 通过 `DSH_SAFE_MODE_DISABLED=1` 运行。恢复本地依赖视图后，定向 CLI 与 app-boot 测试通过；此前 pnpm 在 `node-pty@1.2.0-beta.15` 处的重建失败属于环境准备问题，不是产品测试结果。
