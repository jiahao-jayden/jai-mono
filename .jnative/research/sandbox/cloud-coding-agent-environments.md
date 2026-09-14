# 主流 Coding Agent 的云端执行环境：本地与云端如何对齐

核验日期：2026-08-26。本文以 GitHub Copilot cloud agent / Copilot CLI、Claude Code Web / Cloud，以及 OpenAI Codex cloud 的官方公开文档和公告为准；在线文档均按本日期访问，固定公告按其发布日期引用。它们的底层实现、内部 RPC 和完整持久化策略没有全部公开，本文不把未公开部分当作事实。

## 结论

1. 三个产品都把云端执行放在隔离、可回收的 Linux 环境或 sandbox 中，而不是让 Web 服务直接操作用户桌面。GitHub 把 cloud-agent 会话放在独立 ephemeral development environment；Claude 把每次任务放在独立 cloud VM / sandbox；Codex 把每个云端任务放在自己的 cloud sandbox。这个共同点说明「Agent 的文件与命令必须有一个被绑定的机器环境」是行业基线，而不是单纯的储存适配问题。[GitHub：cloud agent 的环境](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)；[Claude：Web quickstart](https://code.claude.com/docs/en/web-quickstart)；[OpenAI：Introducing Codex](https://openai.com/index/introducing-codex/)

2. 三者解决本地/云端差异的主通道都是 **Git 代码与可重建配置**，不是把云端文件操作代理回用户机器。Copilot 用仓库 checkout、环境 setup workflow 和 PR 交付；Claude 云端从 GitHub clone 或从 CLI 发送 Git bundle，再以 branch/PR 或 `teleport` 回到本地；Codex 云端预加载仓库，在 sandbox 中改动后以 diff / PR 交付。这让云端机器可以完全独立、可隔离、可重试，但意味着本地文件系统本身不是云端 Session 的透明后端。[Copilot setup steps](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment)；[Claude：从本地仓库启动 Cloud session](https://code.claude.com/docs/en/remote-control)；[Codex：云端任务与 PR](https://openai.com/index/introducing-codex/)

3. Cloud workspace 通常不是 durable fact。Copilot 的 agent development environment 是 ephemeral；Claude 在环境停止或到期后会回收 VM，恢复会话时在新环境重新 clone；Codex 公开材料称每个 task 有自己的 sandbox，并描述容器缓存是为了加速后续启动，而非承诺把该 sandbox 作为永久工作区。因此 durable 的东西主要是 Git remote、PR/branch、会话/任务记录和环境配置，而不是某次运行的文件系统。[GitHub：development environment 是 ephemeral](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)；[Claude：环境停止与恢复](https://code.claude.com/docs/en/claude-code-on-the-web#environment-lifecycle)；[OpenAI：Codex 更新中的 container cache](https://openai.com/index/introducing-upgrades-to-codex/)

4. Claude 的公开模型最明确地区分了 **可复用的 Cloud Environment 配置** 与 **每次任务的实际机器**：Environment 保存 setup script、环境变量、网络访问和资源选择；每次 cloud session 使用该配置创建隔离环境。停止后 VM 会被回收，而对话历史仍可恢复。这是「环境定义/配置」和「环境实例/机器」两个层次，不是一个永久的共享目录。[Claude：environment configuration](https://code.claude.com/docs/en/claude-code-on-the-web#configure-cloud-environments)；[Claude：environment lifecycle](https://code.claude.com/docs/en/claude-code-on-the-web#environment-lifecycle)

5. 云端与本地并不会自动获得相同的插件、权限和本机配置。Claude 明确列出 Cloud sessions 不支持 `/plugin`，并只读取仓库内配置或 Cloud Environment 配置；Copilot cloud agent 通过仓库的 instructions、MCP 配置和 Actions setup steps 配置，而不是扫描开发者电脑；Codex 云端的公开资料描述的是 repository-backed cloud sandbox 和托管的环境配置。主流做法是把云端允许的能力显式物化/预装到云机器，而不是给云端 Agent 一个通往用户本地 `fs` 的隐式通道。[Claude：Cloud session 限制](https://code.claude.com/docs/en/web-quickstart#feature-availability)；[Copilot：为 cloud agent 配置环境](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment)；[Codex：cloud environment 管理](https://learn.chatgpt.com/docs/environments/cloud-environment)

6. 本地/云端的「统一」在这些产品里主要是产品层的 Session、任务、Git 交付和环境选择，而不是公开的、跨本地和云端的文件/进程协议。Copilot 对 CLI 暴露 local sandbox 与 `--cloud` session 两种运行位置；Claude 在 Desktop 把 Local、Remote Control 和 Cloud 等作为不同环境，并可把 cloud task `teleport` 到终端；Codex 让 Web、CLI 与 IDE 在同一 Codex 体验中衔接并保留 task context。已审阅的官方材料均未公开一个可供宿主实现的通用 `read/write/list/exec` 运行时接口，也未称本地和云端共享同一文件系统。[Copilot：cloud 和 local sandboxes](https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes)；[Claude：Web 与 Desktop 环境选择](https://code.claude.com/docs/en/web-quickstart)；[Codex：Web、CLI、IDE 的工作流](https://openai.com/index/introducing-upgrades-to-codex/)

7. 因而，公开行业模式可概括为：**环境 provider 负责创建/连接本机或云端机器；运行中的 Agent 使用该机器中的文件与命令；Git/PR 和会话记录负责跨机器衔接。** Claude 的 Cloud Environment 最接近可复用的环境定义，Copilot 最清楚地公开 local/cloud sandbox 的双模式，Codex 最强调跨 Web/CLI/IDE 的任务衔接；但在可公开核验的资料范围内，尚未看到任一产品把这个共同执行层作为通用、可替换的宿主协议对外发布。

## 对比速查

| 维度 | GitHub Copilot cloud agent / CLI | Claude Code Web / Cloud | OpenAI Codex cloud |
| --- | --- | --- | --- |
| 云端机器 | Cloud agent 在每个任务独立的 ephemeral development environment 中运行。CLI 的 `--cloud` session 也使用远程、隔离的 ephemeral Linux 环境。[来源](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent) [来源](https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes) | 每项任务都有专属 isolated cloud sandbox / VM；可选的 Cloud Environment 为这些 session 提供共享配置。[来源](https://code.claude.com/docs/en/web-quickstart) [来源](https://code.claude.com/docs/en/claude-code-on-the-web#configure-cloud-environments) | 每个 cloud task 在自己的 sandbox 中运行，仓库预加载到该环境。后续产品更新说明常见 setup 结果可通过 container cache 加速。[来源](https://openai.com/index/introducing-codex/) [来源](https://openai.com/index/introducing-upgrades-to-codex/)|
| 代码怎样到云端 | 默认从 GitHub 仓库 checkout；可在仓库中配置 `copilot-setup-steps.yml` 安装依赖/初始化开发环境。完成通常通过 PR 表达代码结果。[来源](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment) [来源](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent) | Web 直接从 GitHub clone；CLI 可发起 cloud session：有 remote 时使用 remote，没有 remote 时上传 Git bundle。`teleport` 时需本地工作树 clean，并从 cloud task branch 拉取改动。[来源](https://code.claude.com/docs/en/remote-control) [来源](https://code.claude.com/docs/en/web-quickstart)| 云端任务的 sandbox 预加载用户仓库；任务可创建 commit / PR，或把 diff 带回本地工作流。[来源](https://openai.com/index/introducing-codex/) [来源](https://openai.com/index/introducing-upgrades-to-codex/)|
| 什么持久、什么会消失 | Agent 开发环境是 ephemeral；工作成果应在仓库/PR 中持久化。Setup workflow 是可重跑的仓库配置。[来源](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent) [来源](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment) | Cloud Environment **配置**是可复用的，但具体 VM 会在停止/超时后回收；恢复 Session 时重新 clone 仓库并恢复 conversation history。[来源](https://code.claude.com/docs/en/claude-code-on-the-web#environment-lifecycle)| 官方材料承诺 task sandbox 隔离及 container cache，未承诺单个 task 的文件系统永久保留；代码交付走 Git/PR。[来源](https://openai.com/index/introducing-codex/) [来源](https://openai.com/index/introducing-upgrades-to-codex/)|
| 与本地 CLI/IDE 的关系 | CLI 默认在用户机器；可显式选择 cloud session。GitHub 将本地和云端称为 local / cloud sandboxes，二者的隔离目的相同但运行位置不同。[来源](https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes)| Claude Desktop 可选 Local、Remote Control、Cloud 等环境；Cloud task 可 `teleport` 到终端继续，但不是把云端 VM 挂成本地目录。[来源](https://code.claude.com/docs/en/web-quickstart) [来源](https://code.claude.com/docs/en/remote-control)| Codex Web 可委派 cloud task；CLI 与 IDE 本地工作流可打开/继续 cloud task 的上下文。资料描述的是 context 与 code review 的衔接，不是共享的本地/云端文件挂载。[来源](https://openai.com/index/introducing-upgrades-to-codex/)|
| Skills / plugins / config 在云端 | 仓库 instructions、MCP 配置和 setup steps 是显式输入；cloud agent 的环境按仓库配置构建。[来源](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment)| Cloud session 使用 Cloud Environment 或仓库配置；功能表中 `/plugin` 为不支持，反映云端不承诺接管用户本地插件目录。[来源](https://code.claude.com/docs/en/web-quickstart#feature-availability)| 已公开的是 cloud environment、sandbox 与 GitHub repository 的控制面。当前公开资料不足以证明 Web task 会自动加载用户桌面本地 Skills/Plugins；不能据此假定存在本地目录同步。[来源](https://learn.chatgpt.com/docs/environments/cloud-environment) [来源](https://openai.com/index/introducing-codex/)|
| 是否公开统一执行协议 | 产品公开了 local/cloud sandbox 选择和行为，但没有对外发布可由第三方实现的跨环境文件/命令 interface。[来源](https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes)| 公开了 Cloud Environment 的配置模型和多个运行位置，但没有公开 portable `fs + exec` host contract。[来源](https://code.claude.com/docs/en/web-quickstart)| 公开了 cloud task / environment 控制面和本地工具；没有公开统一的本地/云端 execution-environment API。[来源](https://openai.com/index/introducing-upgrades-to-codex/) [来源](https://learn.chatgpt.com/docs/environments/cloud-environment)|

## 各产品的实际边界

### GitHub Copilot：把同一种安全目标做成 local / cloud 两种执行位置

GitHub 的 cloud agent 使用 GitHub Actions 驱动的 development environment。官方文档指定其为 ephemeral 环境，并允许仓库用 `copilot-setup-steps.yml` 在 agent 开始前安装工具和配置开发环境；这使可执行依赖、项目配置和代码共同落在远程机器内。[配置 development environment](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment)

Copilot CLI 的官方 sandbox 文档把执行位置显式分为 local 与 cloud：本地 sandbox 在用户设备上保护 workspace，cloud sandbox 则是在远程的 ephemeral Linux 环境；CLI 用 `--cloud` 创建后者。两者共享的是 sandbox 的安全语义和 CLI 工作流，不是某个跨机器的文件操作 API。[Cloud and local sandboxes](https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes)

其差异收敛方法是 GitHub 仓库与 PR：云端 checkout 可重建环境，PR 持久化代码变更。官方文档没有把 cloud-agent 进程直接接到发起者电脑的文件系统；相反，它把远程 setup、instructions 和访问权限放在仓库/组织侧配置中。[About GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)

### Claude：把 Environment 当成可复用配置，而把 VM 当成可回收实例

Claude Code Web 的官方 quickstart 明确说 cloud sessions 在 Anthropic-managed cloud 中运行，每个任务有独立 sandbox；Claude Desktop 允许用户在 Local、Remote Control、Cloud 三类环境间选择。也就是说产品层统一的是一次 task/session 的体验，执行实体仍取决于被选中的环境。[Web quickstart](https://code.claude.com/docs/en/web-quickstart)

Cloud Environment 可以设置 setup script、环境变量、网络权限、CPU/RAM 和默认配置，供多个 cloud session 使用；具体 Session 启动时 clone repository 并执行 setup。环境停止或超时后 VM 会被回收；重新启动会在一个新环境 clone repository，但 conversation history 会恢复。因此它清晰采用“配置 durable，计算资源可丢弃”的模型。[Configure Cloud Environments](https://code.claude.com/docs/en/claude-code-on-the-web#configure-cloud-environments)；[Environment lifecycle](https://code.claude.com/docs/en/claude-code-on-the-web#environment-lifecycle)

Claude 对本地/云端差异也不做隐式目录同步。`claude --remote` 的云端任务可使用 Git remote 或本地 Git bundle；回到终端的 `teleport` 要求干净 working tree 并拉取 cloud branch。Cloud 的 feature availability 还明确排除了 `/plugin`。这说明 Cloud 只加载明确放进 Cloud Environment、repository 或受支持产品入口的能力，而不是自动获取用户本地插件与任意文件。[Remote Control](https://code.claude.com/docs/en/remote-control)；[Feature availability](https://code.claude.com/docs/en/web-quickstart#feature-availability)

### OpenAI Codex：以 repository-backed cloud task 衔接 Web、CLI 与 IDE

Codex 发布公告描述 Web 端把任务交给云端 sandbox 执行，每个任务在自己的环境中运行，仓库被预加载。Agent 在该机器中浏览代码、运行测试、修改文件；完成后用户审阅其结果，再创建 PR 或将变更引回本地。[Introducing Codex](https://openai.com/index/introducing-codex/)

后续公告说明 Codex 将 cloud task 与 CLI、IDE 的本地体验衔接，并会扫描常见安装脚本、使用 container cache 加速后续任务。这里的 cache 优化了重复 provision 的启动成本，不等同于公开承诺某个 task VM 永久保存；持久且可审阅的代码结果仍是 Git 分支、commit 和 PR。[Introducing upgrades to Codex](https://openai.com/index/introducing-upgrades-to-codex/)

ChatGPT 的 Codex 管理文档把 cloud environment 作为可创建、编辑、删除并关联 GitHub repository 的对象，属于 control plane。公开资料没有描述一个可以把本地磁盘、E2B 或其他 sandbox 实现代入的通用 `files/commands` 协议；也没有证据表明 cloud task 自动读取本地用户的 Skills/Plugins 目录。[Codex cloud environment](https://learn.chatgpt.com/docs/environments/cloud-environment)

## 可复用的行业模式（不对任何具体实现作评价）

```text
本地或云端环境 provider
        │  创建 / 连接一台可执行机器
        ▼
隔离的 workspace + 文件系统 + shell/process
        │  读取仓库与显式环境配置，运行 Agent
        ▼
Git branch / PR / diff ──> 跨机器代码交付
Session / task history ──> 恢复对话或任务上下文
```

从三个产品公开的行为可区分出三类事实：

| 事实 | 典型位置 | 为什么不应混为一层 |
| --- | --- | --- |
| 可执行工作区、命令、预装依赖 | 某个本地 workspace 或某个 cloud sandbox | 需要机器、权限与资源生命周期；可被回收/重建。|
| 环境选择与构建配置 | repository config、Cloud Environment、组织控制面 | 决定机器启动时有什么，但不是机器本身。|
| 代码交付与可恢复记录 | Git branch/PR/commit、task/session history | 需要跨环境存活，不能以一次 sandbox 的临时磁盘作为唯一事实源。|

## 已知空白与边界

- GitHub、Anthropic 和 OpenAI 的公开资料都没有完整披露其内部 sandbox RPC、文件边界实现或所有的 session persistence schema；不能据此推断它们内部不存在 adapter，但不能把它当作公开可复用契约。
- 「没有公开通用执行协议」是对本次所审阅官方材料的限定，而不是对所有私有 API 或未来版本的绝对断言。
- 本文不讨论 Pi、OpenHands，也不判断任何项目是否领先；它只归纳三个可核验产品已经公开的云端/本地边界。

## 对后续架构讨论的事实约束

1. 云端 Agent 不能以 Server process 的当前目录代替用户工作区；已公开产品均将工作负载绑定在隔离机器中。
2. 要实现可恢复的云端体验，应该把可重建的环境配置和短生命周期的机器实例分开；Claude 对这一区分最明确。
3. 要实现本地/云端来回继续，Git branch/PR/diff 和 conversation/task context 是已验证的交接机制；公开产品没有采用任意反向代理云端文件请求到桌面的模型。
4. 云端的 Skills、Plugins、config 如果依赖文件或进程，应当成为 remote machine 中显式可用的输入；不能默认扫描用户电脑的安装目录。Claude 对 plugins 的明确限制尤其说明这个边界可被产品主动收紧。
