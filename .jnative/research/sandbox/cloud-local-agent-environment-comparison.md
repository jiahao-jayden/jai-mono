# 云端 Agent 如何处理本地 / 云端执行环境，与 JAI 的位置

核验日期:2026-08-26。本文汇总三份独立一手来源调研，分别固定 Pi
`e86823096c5bad39e1ca282ec24bc5eb9bec745b`、OpenHands SDK
`90917f02ab2312ce47b710ad1c2aa8da76c918b1`，以及截至本日期访问的
GitHub Copilot、Claude Code 和 OpenAI Codex 官方文档。固定源码版本是
为了让框架级结论可复核；云产品文档按核验日期引用，因为其实现并不公开。

相关逐项证据见:

- [Pi Agent](./pi-agent-cloud-environment.md)
- [OpenHands](./openhands-cloud-environment-comparison.md)
- [Copilot、Claude 与 Codex](./cloud-coding-agent-environments.md)

## 结论

1. **JAI 的核心判断是行业基线，不是孤立创新。** Pi Core 已有由
   filesystem + shell 组成、注入给 Tool 的 `ExecutionEnv`; OpenHands 的
   `BaseWorkspace` 统一命令与文件操作；Copilot、Claude 和 Codex 都让云端
   coding task 在独立的 Linux environment / VM / sandbox 中执行。它们都
   没有把 Web Server 的当前目录或用户桌面目录当作云端 Agent 的透明后端。
   [Pi](./pi-agent-cloud-environment.md#结论)
   [OpenHands](./openhands-cloud-environment-comparison.md#结论)
   [云产品](./cloud-coding-agent-environments.md#结论)

2. **把 E2B 作为云端环境操作协议是合理的实现选择。** 它让 Cloud 直接
   复用 sandbox lifecycle、文件 CRUD 和命令执行，而不需要 JAI 自建
   filesystem/process RPC 或 sandbox control plane。Desktop 不需要实现 E2B
   server；它以本地 Node adapter 提供同一组 Agent 所需操作即可。这与 Pi
   Core 的 Node adapter 结构一致，也与 OpenHands 的「provision / attach 一台
   真实机器」方向一致。[Pi 的 contract 与 adapter](./pi-agent-cloud-environment.md#pi-core已经存在的执行环境契约)
   [OpenHands Cloud](./openhands-cloud-environment-comparison.md#结论)

3. **“同一份 Tool-facing contract”与“同一个 E2B wire protocol”不是一回事。**
   Pi 已证明 Tool 可只依赖一个 environment interface；但它的 coding-agent
   产品层仍有 `process.cwd()` 与直接 `node:fs` 路径。E2B 也没有本地 adapter
   当前承诺的 canonical `realpath`、原子写、临时文件、filesystem `glob/grep`。
   因此 JAI 必须保持一个由真实 Tool 需求裁剪的 adapter contract，不能让
   Desktop 复刻 E2B SDK，也不能假装 E2B 完整具备 Node 语义。
   [Pi 的产品层断层](./pi-agent-cloud-environment.md#pi-coding-agent产品层的本地绑定仍然存在)
   [E2B 差异](../../docs/research/e2b-execution-environment-protocol-2026-08-26.md)

4. **主流云产品处理本地 / 云端差异的方式，是可重建环境 + Git/PR/diff +
   Session history，不是远程透明访问开发者电脑。** Copilot checkout 仓库并以
   setup workflow 配环境；Claude 从 GitHub 或 Git bundle 起任务，并通过 branch
   / teleport 回本地；Codex 在 repository-backed sandbox 中工作并以 diff/PR
   交付。Claude 还最清楚地区分了可复用的 Cloud Environment 配置与每次可回收
   的 VM。JAI 应把这一经验用于 Web 的 workspace materialization，而不能把
   沙箱磁盘或 Server cwd 当 durable source of truth。
   [产品比较](./cloud-coding-agent-environments.md#对比速查)

5. **JAI 有机会比 Pi 当前公开 coding-agent product path 更完整，但还不能称
   为整体领先。** 若 JAI 实现以下完整链条：Operation 在 durable admission 前
   绑定环境；DB 只决定 Skill/Plugin/config 的版本或 enablement；运行所需字节
   物化到环境机器；所有 Tool 与 Extension 经注入 capability 访问环境；Session
   Journal 与 sandbox lifecycle 独立；本地/E2B 使用同一 contract-test suite——
   那么它在 local/cloud 事实归属上会比 Pi 当前的 core/product 分裂更完整。
   但 OpenHands 已把完整 Agent Server、Tools 与 workspace 放入 sandbox；JAI
   当前仍让 Agent loop / trusted Extension 留在 Host。因此在不受信任扩展的隔离
   上，JAI 目前不领先。[Pi 判断](./pi-agent-cloud-environment.md#对-jai-当前设计的影响)
   [OpenHands 对比](./openhands-cloud-environment-comparison.md#与-jai-方案逐项比较)

## 公开方案的共同结构

```text
本地 workspace 或云端 sandbox / VM
        │
        ├─ 真实 filesystem + process namespace
        │       └─ Agent Tool / Skill / command 在此读取或执行
        │
        ├─ 环境定义: template、setup、network、允许的文件化能力
        │
        └─ 可丢弃 / 可重建的环境实例

Git branch / PR / diff ─────────────── 跨机器交付代码
Session / task history ─────────────── 恢复对话与任务上下文
```

| 维度 | Pi | OpenHands | Copilot / Claude / Codex | JAI 拟议 |
| --- | --- | --- | --- | --- |
| Tool 对机器的抽象 | `ExecutionEnv` | `BaseWorkspace` | 未公开给宿主的通用 interface | 薄 `ExecutionEnvironment` |
| 云端机器获取 | Docker / OpenShell 或 Tool routing | Cloud workspace provision / attach | 产品自有 ephemeral environment | E2B `create/connect/pause` provider |
| 本地与云端文件是否透明共享 | 否；全进容器或 Tool 转发 | 否；remote client 到 agent-server | 否；Git/PR/diff 交接 | 否；物化到选中环境 |
| Session 与机器的关系 | remote transport 不负责 sandbox | conversation 与 live workspace 分离 | Session/history 可保留，VM 常回收 | Journal 与 environment reference 分离 |
| 云端本地 Plugin 自动加载 | Extension 默认 host code | 执行侧可从 filesystem source 加载 | 通常显式 environment / repository input；Claude Cloud 不支持 `/plugin` | 禁止 DB 动态 Plugin；只允许受信任预置/显式物化 |
| 不受信任 Extension 的隔离 | Tool routing 不能隔离 host Extension | Agent/Tools 在 sandbox server 侧 | 内部实现未公开 | **未解决；Host 运行时不等于 E2B 隔离** |

## 对“是否领先”的准确判断

### 已被验证的行业共识

- Coding Agent 的 file CRUD、shell 与 file-backed Skill 不可能无头发生，必须绑定
  到一台机器或 sandbox。
- 云端不会默认读取用户本地 plugin/config/filesystem；环境通过 repository、setup、
  template、volume 或显式上传获得实际字节。
- 可长期保存的是 session/task record、Git 结果和 environment definition；实际 VM/
  sandbox 往往可以回收、重建或 attach。
- 远程 session/control transport 不是 execution environment protocol。

这些不是 JAI 的差异化卖点，而是应当采用的成熟模式。

### JAI 可形成的领先点

1. **从入口消灭 `process.cwd()` fallback。** 任何 Operation 先 resolve environment
   / workspace，再加载资源与 admit prompt；Pi coding-agent 当前公开路径没有把这个
   invariant 推到产品入口。
2. **把“谁决定加载”“字节在哪台机器”“效果在哪发生”分开。** 这比多数公开产品
   文档更明确地覆盖 Skill、Plugin、config、MCP stdio 与 Extension。
3. **把 provider control plane 与 Tool operation plane 分开。** E2B 的 lifecycle、
   template、token、network 不泄入 Tool；本地不伪造 sandboxId/pause。这比
   OpenHands 公开 `Workspace` API 的单一大对象更适合多端 host。
4. **用跨 adapter conformance tests 固化语义。** 不是“本地能跑、云端也能跑”就算
   完成，而是对 read/write/search/command/cancellation/error DTO 的可观察行为做
   同一组测试。

以上只有在实施后才是领先，不是 intent 本身已经带来的结论。

### 当前不能宣称领先的地方

- E2B 未直接提供 canonical path、原子写、temporary file、`glob/grep` 等本地语义；
  JAI 必须先缩小/分级 contract，不能把差异藏进 adapter。
- 如果 Web 允许任意第三方 Plugin 或 Extension 在 Host 进程中执行，E2B 不会自动
  隔离它们。Pi 的 Gondolin 模式已经证明“只把内置 Tools 路由进 sandbox”不足以
  隔离 host Extension；OpenHands 把 Agent Server 迁入 sandbox 是更强的路线。
- 各主流产品通常以 Git/PR/diff 交接本地与云端。JAI 若希望 session-level E2B
  environment 保留可变 workspace，必须额外定义其与 Git、Volume、snapshot 以及
  失效重建之间的恢复合同。

## 对本项目的影响

1. 保持当前选择：Cloud 直接使用 E2B API，Desktop 使用 Node adapter，Agent 只依赖
   JAI Tool-facing operations。
2. 把 `EnvironmentProvider` 的 contract 设计为 host lifecycle seam，不让它变成
   一般 storage adapter；Session durable journal 也不落到 E2B sandbox filesystem。
3. 把 remote materialization 作为 Operation preparation 的显式步骤：选定 Skill /
   config revision -> 写入或验证 template/Volume 中的字节 -> 再 admit prompt。
4. 先明确 Web Extension 信任边界。当前“仅受信任、随服务部署的 Extension + 注入
   capability + 无 DB 动态 Plugin”与 Host-loop 兼容；若要租户第三方可执行 Plugin，
   应另开 extension-runtime-isolation 特性，将 Agent/Extension worker 迁入 E2B 或
   同等级隔离 runtime。
5. 计划阶段以 Pi Core 的 `ExecutionEnv` 和现有 JAI Tools 为 gap checklist，但以 E2B
   的实际 API 限制决定共同 contract，而不是照抄 Pi 或把 Node 本地保证带到云端。
