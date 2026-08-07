# Vercel Plugin 调研

调研日期：2026-08-07

## 结论

Vercel Plugin 是面向 AI coding agent 的本地知识与工作流分发包，不是新的部署 API，也不等同于 Vercel MCP 或 Vercel CLI。它把 Vercel 生态知识图、Agent Skills、专家 agent 定义、斜杠命令和会话 hooks 一起安装到受支持的 coding tool 中；真正读取或修改 Vercel 账户资源时，仍然依赖 Vercel CLI 或远程 Vercel MCP。

对 jai-mono/PandaWork 来说，最有现实价值的是它的 `SKILL.md` 内容和资源文件。PandaWork 当前能读取 `.agents/skills` / `.jai/skills`，所以单个 skill 可以复用；但它没有 Vercel Plugin manifest 安装器，也不解析这套 `SessionStart` / `SessionEnd` hook manifest、专家 agent manifest 或带命名空间的 `/vercel-plugin:*` 命令。因此不能把官方的 `npx plugins add vercel/vercel-plugin` 当成 PandaWork 的完整集成方案。

## 来源口径与版本漂移

本文把两套口径明确分开：

- **已发布文档口径**：Vercel 文档页标记 `last_updated: 2026-07-29`，列出 28 skills、3 agents、5 commands，激活条件是空目录或 Vercel/Next.js 项目。[Vercel Plugin 文档](https://vercel.com/docs/agent-resources/vercel-plugin)
- **当前官方源码口径**：本文固定检查官方仓库 `main` 的 commit [`3878c45`](https://github.com/vercel/vercel-plugin/commit/3878c45e788c4d55f1715c33cab4ade962f69822)，提交时间 2026-08-05。manifest 版本是 `0.46.0`，目录中实际有 31 skills、3 agents、4 commands，并已把 Eve 加入 skill 与自动激活检测。[通用 manifest](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/.plugin/plugin.json)；[Claude manifest](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/.claude-plugin/plugin.json)；[README](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/README.md)

源码自身也有一处文档漂移：README 的 Components 段写 4 commands，实际 command 文件和 Claude manifest 也是 4 个，但 README 的 Architecture 树仍写 5 个。判断“当前可执行实现”时，应以 manifest 和文件树为准。发布文档中的 `marketplace` command 在当前源码已不存在，Marketplace 仅保留为 skill。

## 安装与使用

官方前置条件是 Node.js 18+、Bun，以及以下任一工具：Claude Code、OpenAI Codex、Grok Build、Cursor、GitHub Copilot 或 Kimi Code。安装命令是：

```bash
npx plugins add vercel/vercel-plugin
```

安装后可按需调用 skill 或 command；官方文档示例包括 `/vercel-plugin:nextjs`、`/vercel-plugin:ai-sdk` 和 `/vercel-plugin:deploy prod`。默认自动化是轻量的，不会在每次 prompt 或 tool call 都注入所有 Vercel 内容。[安装与用法](https://vercel.com/docs/agent-resources/vercel-plugin#getting-started)

当前源码的会话启动检查会读取项目根目录的 `package.json`、`.vercel`、`.eve`、`vercel.json` 和 `next.config.*`。仅当目录为空，或检测到 Eve、Next.js、Vercel 依赖/脚本/标记时，才注入薄上下文和 `knowledge-update`；repo profiler 再根据配置与依赖生成可能相关的 skill 提示。[激活逻辑](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/hooks/src/session-start-activation.mts)；[上下文注入](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/hooks/src/inject-claude-md.mts)；[repo profiler](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/hooks/src/session-start-profiler.mts)

排障可使用 `VERCEL_PLUGIN_LOG_LEVEL=debug` 和 `npx vercel-plugin doctor`。doctor 检查 manifest 一致性、hook 超时风险、去重状态和 skill map。[调试说明](https://vercel.com/docs/agent-resources/vercel-plugin#debugging)

## 当前源码包含什么

### 31 个 skills

当前 `0.46.0` 源码包含：

`access-protected-vercel-deployment`、`ai-gateway`、`ai-sdk`、`auth`、`bootstrap`、`cdn-caching`、`chat-sdk`、`deployments-cicd`、`env-vars`、`eve`、`knowledge-update`、`marketplace`、`microfrontends`、`next-cache-components`、`next-forge`、`next-upgrade`、`nextjs`、`react-best-practices`、`routing-middleware`、`runtime-cache`、`shadcn`、`turbopack`、`vercel-agent`、`vercel-cli`、`vercel-connect`、`vercel-firewall`、`vercel-functions`、`vercel-sandbox`、`vercel-storage`、`verification`、`workflow`。[固定版本 skills 目录](https://github.com/vercel/vercel-plugin/tree/3878c45e788c4d55f1715c33cab4ade962f69822/skills)

其中 11 个 skill 从 Vercel 或 Vercel Labs 的上游仓库同步，再叠加插件自己的匹配、校验和 chain metadata；这意味着它们不只是静态教程，还包含按文件路径、依赖、prompt signal 选取内容的规则。[Upstream Skill Sync](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/README.md#upstream-skill-sync)

### 3 个专家 agents

- `deployment-expert`：CI/CD、部署策略、故障排查、环境变量。
- `performance-optimizer`：Core Web Vitals、渲染、缓存、资源优化。
- `ai-architect`：AI 应用架构、模型选择、流式架构、MCP。

来源：[固定版本 agents 目录](https://github.com/vercel/vercel-plugin/tree/3878c45e788c4d55f1715c33cab4ade962f69822/agents)

### 4 个 commands

- `bootstrap`：项目链接、环境和数据库初始化。
- `deploy`：preview/production 部署。
- `env`：环境变量管理。
- `status`：项目与部署状态概览。

来源：[Claude plugin manifest](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/.claude-plugin/plugin.json)

### Hooks 与知识图

`vercel.md` 是 Vercel 产品、库、CLI、API、服务及跨产品决策关系的知识图。默认 hook profile 运行 3 个 SessionStart Node 脚本和 1 个 SessionEnd 清理脚本；当前 manifest 没有启用仓库中仍保留的 prompt/tool-call 自动注入引擎。[hook manifest](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/hooks/hooks.json)；[生态知识图](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/vercel.md)

## 与其他 Vercel Agent Resources 的区别

| 资源 | 本质 | 是否访问账户 | 适合场景 |
| --- | --- | --- | --- |
| Vercel Plugin | 本地知识、skills、agents、commands、hooks 的组合包 | 自身不是账户 API；工作流可引导调用 CLI/MCP | 给 coding agent 持续的 Vercel 专项能力 |
| Vercel MCP | `https://mcp.vercel.com` 上的远程 MCP，OAuth 授权 | 是；可查项目、部署、日志、分析，也包含有副作用的工具 | 让 agent 结构化读取/操作 Vercel 账户 |
| Vercel CLI | 本机实际命令行执行器 | 登录或 token 后可操作账户和部署 | 部署、env、logs、rollback 等确定性操作 |
| Agent Skills / skills.sh | 可单独安装的模块化 `SKILL.md` 能力 | 取决于 skill 调用的工具 | 只需要少数专项能力，不要整套插件 |
| Markdown / `llms-full.txt` | 只读文档上下文 | 否 | 一次性问答或显式提供官方资料 |
| CLI Workflows | 官方文档中的多步 CLI 操作范式 | 通过 CLI | 调试、恢复、部署的可复用 runbook |
| `vercel agent init` | 向 `AGENTS.md`/`CLAUDE.md` 写入有 marker 的部署建议 | 否 | 给单个仓库持久加入静态规则 |

来源：[Agent Resources 总览](https://vercel.com/docs/agent-resources)；[Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp)；[MCP tools](https://vercel.com/docs/agent-resources/vercel-mcp/tools)；[CLI](https://vercel.com/docs/cli)；[Agent Skills](https://vercel.com/docs/agent-resources/skills)；[CLI Workflows](https://vercel.com/docs/agent-resources/workflows)；[`vercel agent`](https://vercel.com/docs/cli/agent)

关键边界是：Plugin 提供“怎么做”的上下文与编排，MCP 提供结构化远程工具，CLI 提供实际命令执行。三者可以协作，但互不替代。

## 安全、信任与限制

- 官方仓库属于 `vercel/vercel-plugin`，当前 manifest 标记 Apache-2.0。[manifest](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/.plugin/plugin.json)；[LICENSE](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/LICENSE)
- 这不是纯 Markdown 包。安装后会在 agent 生命周期中执行仓库提供的 Node 脚本，读取项目配置与依赖，在临时目录和用户配置目录写入 session/telemetry marker。因此应像审查其他开发工具插件一样审查版本和 hooks，而不是把它视为无执行权限的文档。[hook manifest](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/hooks/hooks.json)；[hook 文件操作](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/hooks/src/hook-env.mts)
- Telemetry 默认开启。当前源码最多每天发送一次 `dau:active_today`，首次成功上报还会发送 `plugin:first_use` 和版本事件；请求不包含 prompt、bash/tool-call 内容、文件路径、项目名或账户 ID。设置 `VERCEL_PLUGIN_TELEMETRY=off` 可全部关闭。[文档](https://vercel.com/docs/agent-resources/vercel-plugin#telemetry)；[固定版本实现](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/hooks/src/telemetry.mts)
- MCP 是另一条更高权限边界。它使用 OAuth，Vercel 只允许已审核客户端连接；官方明确建议为 tool execution 开启人工确认，并警惕与其他 MCP server 联用时的 prompt injection。[MCP 连接限制](https://vercel.com/docs/agent-resources/vercel-mcp#connecting-to-vercel-mcp)；[MCP 安全提示](https://vercel.com/docs/agent-resources/vercel-mcp/tools)
- Plugin 的专业建议仍可能过期或误匹配；官方提供 debug log、doctor 和 issue 流程，说明其路由与知识并非正确性保证。[Reporting issues](https://vercel.com/docs/agent-resources/vercel-plugin#reporting-issues)
- 官方支持列表不包含 PandaWork。文档也没有承诺通用 plugin manifest 之间完全等价；源码实际同时维护通用、Claude、Cursor、Kimi manifest，平台能力存在差异。[Supported tools](https://vercel.com/docs/agent-resources/vercel-plugin#supported-tools)；[固定版本仓库](https://github.com/vercel/vercel-plugin/tree/3878c45e788c4d55f1715c33cab4ade962f69822)

## 对 jai-mono / PandaWork 的实际意义

### 可直接借鉴

1. PandaWork 已扫描受信 workspace 与用户目录下的 `.jai/skills`、`.agents/skills`，并支持读取 skill 内资源；Vercel 的 skill 目录都有标准 `SKILL.md`，所以按需复制单个 skill 具有较高可行性。[PandaWork skill catalog](../../packages/coding/src/skills/catalog.ts)
2. PandaWork 会解析 `name`、`description`、`metadata`、`allowed-tools`，Vercel skill 的基础 frontmatter 可以被加载；其嵌套 metadata 会被当前实现字符串化，但正文仍可使用。[PandaWork skill parser](../../packages/coding/src/skills/catalog.ts)
3. `ai-sdk` 对本仓库尤其相关，因为 Desktop 已依赖 AI SDK v6；`verification`、`react-best-practices` 和 `shadcn` 也可能有局部价值。[Desktop package](../../app/desktop/package.json)

### 不能直接获得

1. PandaWork 当前没有 `plugins add` 兼容层或 plugin manifest loader，无法自动安装整包。
2. PandaWork 的 slash 解析只接受 `/name`，不接受冒号命名空间，所以官方示例 `/vercel-plugin:nextjs` 不会按 skill 调用解析；安装成 PandaWork skill 后应使用 `/nextjs`。[slash 解析](../../packages/coding/src/skills/runtime.ts)
3. Vercel 的 hooks 是 Claude/Cursor 风格的外部进程生命周期协议；PandaWork 虽有自己的 typed hooks/extensions，但不会读取 `hooks/hooks.json`。自动项目识别、knowledge update 注入、telemetry、doctor 和去重逻辑都不会因复制 skills 而出现。[PandaWork hooks](../../packages/agent/src/harness/hooks.ts)
4. 3 个专家 agent 定义和 4 个 command 模板也不会自动映射到 PandaWork 的通用 `SpawnAgent` 或 command 机制。
5. jai-mono 根 `package.json` 没有 Next.js、Vercel、Eve 或 `@vercel/*` 依赖；即使在支持完整插件的工具中从仓库根启动，当前自动激活逻辑也不会因 `app/desktop` 的间接 `ai` 依赖触发。skills 仍可手动调用。[根 package](../../package.json)；[激活逻辑](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/hooks/src/session-start-activation.mts)

## 建议

当前不建议为 PandaWork 整包接入 Vercel Plugin。更稳妥的顺序是：

1. 先把它视作兼容性样本，验证 `ai-sdk` 或 `verification` 单 skill 在 PandaWork 中的加载、资源读取和回答质量。
2. 若效果明确，再设计独立的 plugin bundle 边界，显式映射 skills、commands、agents、hooks，并对可执行 hooks、网络访问、telemetry 与版本固定提供安装时审查和权限提示。
3. Vercel 账户操作单独通过 MCP/CLI 能力设计，不应因为安装知识插件就隐式获得账户权限。
4. 集成或同步时固定 release/commit，并以 manifest + 文件树做一致性校验；不要依赖当前明显漂移的文档数量。
