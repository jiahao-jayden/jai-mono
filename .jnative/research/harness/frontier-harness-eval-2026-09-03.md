# FrontierHarness Eval：JAI 接入可行性核验

核验日期：2026-09-03。上游固定在 [`runta-dev/frontier-harness-eval@0c402ae`](https://github.com/runta-dev/frontier-harness-eval/tree/0c402ae23724e2d937df0c7038b82203a829a385)；这是为避免上游任务定义或结果变化混入结论。JAI 侧检查的是当前工作树；其 Git `HEAD` 为 `6e6264d45c30a72247b0a50970d75c550ae1be89`，但相关 SDK/CLI 文件有未提交改动，故本文对 JAI 使用本地路径引证，不把它伪装成该 SHA 的源码事实。

## 结论

1. **这不是可直接安装、执行或复刻的 benchmark harness。** 上游只发布冻结的结果与任务定义，且明确排除了内部基础设施、凭据、runtime identifier、私有证据、solution 和部署配置；因此没有公开的 agent-adapter 协议、runner、verifier 实现或官方 eval/smoke 命令。[README：仓库边界](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/README.md#L194-L207)
2. **可公开核验的输入契约是每题 `instruction.md` 加 `task.toml`，不是标准输入/标准输出协议。** `task.toml` 描述 agent/verifier 超时、Docker 镜像、CPU、内存、磁盘、网络和 MCP；自然语言 `instruction.md` 才是给 agent 的任务。上游只承诺同一 Golden Checkpoint 的 fresh restore，并以 verifier 的 pass/fail 打分。[README：统一运行条件及确定性评分](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/README.md#L219-L230)
3. **不能用当前 `jai` CLI 直接做无人工的写代码 trial。** CLI 的非 TTY permission handler 一律选择 reject；同时 CLI 当前没有 `--permission-mode` 或 `--max-turns` 参数。因此应写一个很薄的、直接调用 `@jai/coding-agent` 的 adapter，并只在 task 容器中设 `permissionMode: "bypassPermissions"`、ephemeral session 和明确 `maxTurns`。依据见下方「JAI 最小 adapter」。
4. **即使 adapter 完成，也只能得到“FrontierHarness task-definition compatible”的本地结果，不能与官方榜单横比。** 官方 v1 固定为 Kimi K3/Fireworks、30 题、360 runs，且以 first valid attempt 1 选 canonical result；官方托管的 checkpoint、verifier 和成本重定价细节并未公开。[`benchmark.json`](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/benchmark.json#L1-L39)

## 公开任务格式与资源边界

README 定义的目录是 `tasks/<task>/instruction.md` 与 `task.toml`；30 题由 21 个 Terminal-Bench 任务和 9 个 DeepSWE v1.1 任务组成。[目录与来源](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/README.md#L194-L205) [固定选择与来源版本](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/benchmark.json#L1-L39)

| 公开字段/限制 | 可核验例子 | 对 adapter 的含义 |
| --- | --- | --- |
| 指令 | [图像题指令](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/tasks/code-from-image/instruction.md#L1-L3) 要求读取 `/app/code.png`、写 `/app/output.txt`。 | 将整个 `instruction.md` 原样作为一轮 prompt；workspace 必须是题目容器的 `/app`。图像题还必须保留文件。 |
| 任务文件版本 | DeepSWE Go 样例使用 schema `1.3`，Terminal-Bench 样例使用 `1.1`。 | parser 不能假设一种 schema 或把未识别字段丢弃。|
| 容器与配额 | [DeepSWE Go 样例](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/tasks/anko-typed-variable-bindings/task.toml#L18-L48)：Linux、镜像、2 vCPU、8 GiB、20 GiB、agent 5400s、verifier 1800s、no-network。 | 外层 runtime 真正执行 cgroup/磁盘/网络限制；agent 的 prompt 或 permission policy 不可代替隔离。 |
| 常见 Terminal-Bench 条件 | [Cython 样例](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/tasks/build-cython-ext/task.toml#L22-L43)：1 vCPU、2 GiB、10 GiB、agent/verifier 各 900s、`allow_internet=false`。 | adapter 要读每题值，不可写死一组资源或 900 秒。 |
| 题目能力面 | [图像题元数据](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/tasks/code-from-image/task.toml#L4-L35) 是 OCR/vision；[gRPC 题](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/tasks/kv-store-grpc/task.toml#L4-L35) 要求 Protobuf、server 与后台进程；Go 样例明确标 `language = "go"`。 | 套件是异构软件工程环境，不能以单一语言 runtime 预装假设作为前提。 |
| 公开 artifact | DeepSWE 样例只收集相对 base commit 的 `/logs/artifacts/model.patch`。[对应 collect 命令](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/tasks/anko-typed-variable-bindings/task.toml#L30-L32) | artifact 不是评分结果；不能把成功生成 patch 当作 pass。|

公开 TOML 没有 verifier 断言或 pass/fail 输出格式。官方声明评分由 verifier 决定，但 verifier/solution 在未发布内容中；因此本仓库无法导出“JAI 应向 stdout 写什么才能得分”的协议。[评分声明](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/README.md#L224-L230) [排除项](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/README.md#L203-L207)

## 安装、运行、评分与成本：公开信息的上限

上游 README 唯一的命令是对已发布 `results/eval-data.json` 做 `jq` 查询，而非安装或运行评测。[README：Use the data](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/README.md#L231-L235) 公开结果可用于阅读，但不能作为新的 agent trial 的 grader。

官方结果的评价口径是 verifier pass/fail；摘要同时报告 pass rate、median cost per pass、cache median 和 median time，并将 first-turn cache reads 统一重定价。[结果列](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/README.md#L175-L193) [成本口径](https://github.com/runta-dev/frontier-harness-eval/blob/0c402ae23724e2d937df0c7038b82203a829a385/README.md#L224-L230) 任何本地 JAI 运行都应单独报告 provider/model 版本、raw token 与 raw billed cost；没有 Runta 的重定价规则，不能声称同口径 cost/pass。

## JAI 最小 adapter

建议新增一个 benchmark-host 专用的单进程入口（而非让 benchmark 了解 Agent 内部），每个 trial 做以下事情：

```text
restore task image / golden checkpoint
  -> 在容器内以 cwd=/app 创建 JAI ephemeral CodingAgent
  -> prompt(原始 instruction.md, 可选 image attachment)
  -> 外层 timeout 后杀掉 agent/container
  -> 收集 messages 的 usage/cost、stop reason、tool failures
  -> 由获得授权的 runner 执行该任务的 verifier，记录 pass/fail
  -> 删除 trial 容器与临时凭据
```

SDK 恰好具备这条最小接口：`model`、`cwd`、ephemeral session、`permissionMode`、`maxTurns` 与 `prompt()` 都是公开选项；ephemeral 会创建内存 store 和独立临时配置目录。[本地 `sdk/types.ts`](../../../packages/coding-agent/src/sdk/types.ts)（`CodingAgentCreateOptions` 第 188–221 行，`CodingAgent` 第 358–373 行）[本地 `create-coding-agent.ts`](../../../packages/coding-agent/src/sdk/create-coding-agent.ts)（第 79–145 行）。该 adapter 应以 `Result` 明确投影 setup/provider/runtime/verifier 错误，结果 JSON 只输出白名单字段，不能跨进程泄露 provider error 的 `cause` 或 stack。

建议的伪命令（**不是上游官方命令，必须由拥有 task image 与 verifier 的 host 提供**）是：

```bash
frontier-jai-adapter \
  --task-dir /mounted/frontier/tasks/build-cython-ext \
  --workspace /app \
  --agent-timeout-sec 900 \
  --network none \
  --max-turns 40 \
  --result /logs/jai-result.json
```

其核心配置应等价于：

```ts
const created = await createCodingAgent({
  model,
  cwd: "/app",
  session: { kind: "ephemeral" },
  permissionMode: "bypassPermissions",
  maxTurns: 40,
});
// 处理 Result；仅在网络关闭、CPU/memory/disk/timeout 都由容器强制时执行。
const run = await created.value.prompt(instruction);
```

`bypassPermissions` 只授权 JAI 内层，**不**构成安全边界；网络、文件系统可见范围、进程树、资源上限和 API key 必须由容器 host 强制。provider 凭据只应在 agent 进程可读、在 trial 后撤销；不应置入任务 workspace。每题 agent timeout 应由 TOML 驱动，并在 host 设置比 SDK 略大的硬超时，以覆盖关闭与结果落盘。

JAI 的 assistant messages 带 input/output/cache/reasoning tokens 和 cost 分项，可由 adapter 聚合为每 trial raw 使用量。[本地 `sdk/types.ts`](../../../packages/coding-agent/src/sdk/types.ts)（第 23–68 行）图像题若要把 `/app/code.png` 交给模型视觉输入，SDK 的 `prompt` 另有 `attachments` 和 image callback；目前 harness `Read` 仅承诺 UTF-8 text，因此仅传文本 prompt 会迫使 agent 改走容器内 OCR/工具路线。[本地 `sdk/types.ts`](../../../packages/coding-agent/src/sdk/types.ts)（第 139–145、220–222 行）[本地 `read.ts`](../../../packages/agent/src/harness/tools/read.ts)（第 45–59 行）。

### 为什么当前 CLI 不是该 adapter

CLI 确实有非交互 `-p`、`--cwd`、`--no-session-persistence` 和 `stream-json`，但当前对外 stream JSON 的 final event 只有 `session_id`、`text` 与 `stop_reason`，没有 usage/cost/工具诊断。[本地 `run.ts`](../../../app/cli/src/run.ts)（第 252–265、288–331 行）更关键的是，无 TTY 的 permission handler 选 `reject_once`/`reject`，所以会拒绝常见的 Bash/Edit 写操作。[本地 `run.ts`](../../../app/cli/src/run.ts)（第 334–377 行）

所以不能把下列命令当作当前可用的 smoke：

```bash
# 仅展示 CLI 输入形状；它在无 TTY 下会拒绝需要批准的写操作，且并非官方 FrontierHarness 命令。
bun run cli -- -p --cwd /app --no-session-persistence --output-format stream-json < instruction.md
```

若产品明确要保持 subprocess 形态，最小产品改动是给 CLI 增加受限的 headless benchmark permission mode，以及单一 final DTO（usage、raw cost、stop reason、tool failures）；仍由外层容器与 verifier 负责评测。它不应将 FrontierHarness task/score 语义塞进 `@jai/coding-agent`。

## 对本项目的影响

- 不应现在修改 Desktop 或 Agent loop，也不应写 FrontierHarness-specific 分数逻辑：上游缺 runner、verifier 与 checkpoint，无法作端到端验收。
- 若能从 Runta 获得运行时/评分入口，优先实现独立的 `frontier-jai-adapter` host，使用 SDK 而非当前 CLI；其职责只限 prompt、权限、生命周期和 JSON-safe telemetry 投影。容器、trial 清理、verifier 与资源约束仍是 host 的职责。
- 若只做小规模兼容 smoke，先取得一个**有授权的** task image 与 verifier，选择一个非图像、无外网任务，以其 TOML 的真实 timeout/limits 启动一次；输出必须标注为 local smoke，不能与官方 leaderboard 对比。
- 待核验：Runta 是否提供受控 API/SDK 来请求 golden checkpoint、提交 agent command、运行 verifier 或复算成本。公开仓库没有证据支持这些接口，需直接向维护方索取，而非从任务定义推测。
