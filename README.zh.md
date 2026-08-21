# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

本仓库是 `eiheil2/deepseek-harness` 修复分支。这里发布的预安装运行时
包含尚未进入官方 `@deepseek-ai/dsh` npm 发行版的修复。

## 本修复版解决的问题

相对于本仓库采用的官方 rc8 基线，当前修复版包括：

- **模型能力控制：** 可在模型编辑器中按模型配置文字/图片输入能力和思考
  强度，无需重启即可让下一次模型解析读取新配置。模型选择器显示已声明的
  能力；草稿含图片时禁用明确声明为纯文字的模型；元数据缺失时不根据模型
  名称猜测能力。
- **思考强度路由：** 所选强度跟随精确模型和会话，在切换模型、新建会话与
  分叉时正确保留或恢复。不支持的档位会在发送网络请求前明确失败，不会被
  静默改写。
- **上下文与缓存计量：** 上下文压力与当前 provider/model 路由绑定；显示值
  不会变成负数；无法由本地估算器解释的请求开销单独显示；只有 provider
  实际提供缓存遥测时才显示缓存命中信息。
- **多模态与 ACP 取消：** 精确的图片能力元数据会传递到 Web UI 和 Host API；
  运行时配置更新会在下一次模型解析时生效；取消 ACP 图片或输出转换时不再
  无限等待有序输出尾部。
- **会话与工作区恢复：** 会话已经创建但工作区挂载失败时，界面仍会显示该
  会话并将其恢复到未分组视图，避免看起来像创建失败而重复创建。
- **有界指令加载：** Agent 指令源在首次加载和后续协调中共享默认 8 MiB
  总预算，避免大量指令文件无限占用上下文和内存。
- **更合理的 Web 工具时限：** `web_search` 和 `web_fetch` 的默认协作超时从
  30 秒提高到 120 秒，并且仍可通过配置覆盖。
- **插件启动恢复：** 插件激活失败时，先在当前进程中禁用识别出的可疑条目
  并重试；仍失败时进入只加载随附 bundle 的安全模式。系统会报告可疑插件，
  但不会自动卸载软件包或改写用户 profile。
- **预安装跨平台运行时：** Release 为 Windows x64、Linux x64/arm64 和
  macOS x64/arm64 捆绑 Node.js 与已解析的运行依赖；安装时不运行 npm，
  也不安装测试、调试记录或开发文件。

以上说明的是已经实现并经过测试的代码路径，不代表所有第三方端点都完成了
真实认证。网关没有声明图片、思考、缓存或容量元数据时，系统会保持“未知”，
直到用户配置或完成实际测试。详细工程记录见
[`docs/REPAIR_RECORD_MULTIMODAL_REASONING_2026-08-20.md`](docs/REPAIR_RECORD_MULTIMODAL_REASONING_2026-08-20.md)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 安装

### 我们的修复版

下面的命令安装的是**本仓库的修复版**，不会安装或回退到官方 npm 包。

Windows PowerShell 或命令提示符：

```powershell
git clone --depth 1 https://github.com/eiheil2/deepseek-harness.git
cd deepseek-harness
.\install\install.cmd
```

Linux、WSL2 或 macOS：

```sh
git clone --depth 1 https://github.com/eiheil2/deepseek-harness.git
cd deepseek-harness
sh install/install.sh
```

安装器会自动选择对应平台的资产，校验 SHA-256，并安装已捆绑的 Node
运行时与依赖，全程不运行 npm。当前版本是
`dsh-custom-v0.1.0-rc.8-fullfix.3`。安装路径和高级选项见
[`install/` 说明](install/README.md)。

### 官方上游版本

下面的命令运行 DeepSeek AI 的**官方 npm 发行版**，不是本仓库，也不包含
上面的修复。请先安装 Node.js：

```sh
npx @deepseek-ai/dsh web
```

该命令默认在 `http://127.0.0.1:3080` 启动 Web UI。详见
[Web UI 指南](docs/user/guide/index.md)。

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/eiheil2/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
