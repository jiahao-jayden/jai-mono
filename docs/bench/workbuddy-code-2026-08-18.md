# WorkBuddy-Bench Code 全量评测基线报告（2026-08-18）

## 摘要

本报告记录 Jai CLI 通过 `@jai/coding-agent` 调用 Volcengine Ark 上的 `deepseek-v4-pro-ga-260813`，对 WorkBuddy-Bench Code 数据集进行的第一次完整评测。

最终合并结果：

| 指标 | 结果 |
| --- | ---: |
| 数据集 | WorkBuddy Code v1.0，80 题 |
| 完成试次 | 80 / 80 |
| 基础设施错误 | 0 |
| Reward | **0.75986 / 1.0** |
| 折算百分制 | **75.986 / 100** |
| 测试通过数 | **745 / 926** |
| 测试通过率 | **80.45%** |

Reward 是 80 个 task reward 的平均值；单题满分为 `1.0`，因此总分满分也是 `1.0`。测试通过数是 verifier 暴露的断言总数，和 task-level reward 是两个互补指标。

评测后对 80 份完整 Agent 轨迹做了统计分析，并把每条结论回溯到源码验证（见「轨迹诊断」及各运行时问题章节）。结论修正了本报告初稿的根因判断与优先级：

- `--max-turns 40` 未生效，实测最高 118 turn。根因是 `packages/agent/src/harness/agent.ts:129` 遗漏转发 `maxIterations`，`providerOptions` 一并丢失（后者不影响本次基线的 reasoning，见对应章节）；
- `bypassPermissions` 相关错误共 322 次，但**初稿的根因判断有误**：判定顺序是设计意图（有文档与测试固化），实际缺陷是 CLI 缺少 headless 审批兜底。且该错误与 reward **无相关性**，34 个满分题中 24 个也触发过；
- 修改后未验证与 reward 的关联在每个难度层内都成立（+0.07 ~ +0.33）；
- easy 题平均 reward（0.6071）低于 hard 题（0.7828），且满分题与低分题的 turn、token、耗时基本一致——失分源于工作流而非能力上限；
- 声称「测试通过」的 21 题平均 reward（0.6869）**低于**未声称的 59 题（0.7858），自我报告不可作为完成信号；
- 「编辑前读既有测试」在弱项三类上 +0.226，在其余类别上 **−0.084**，必须条件触发而非全局强制。

因此首要修复项是 harness 参数转发、headless 审批兜底与完成前验证，而非初稿判断的权限判定顺序。

## 目标与边界

评测目标不是为 WorkBuddy 单独实现一个 Agent。WorkBuddy 只消费 Jai 的普通 CLI 进程接口：

```text
WorkBuddy harness
  -> jai CLI
    -> @jai/coding-agent
      -> @jai/agent
        -> provider / tools / workspace
```

本次使用的 CLI 语义与日常 headless coding agent 一致：

```bash
jai --print \
  --output-format stream-json \
  --permission-mode bypassPermissions \
  --no-session-persistence \
  --max-turns 40 \
  -- "$TASK"
```

其中：

- `--print` / `--output-format stream-json`：提供可脚本化、可记录的非交互执行；
- `--permission-mode bypassPermissions`：由调用方明确选择的无人值守执行模式；
- `--no-session-persistence`：每个 benchmark trial 使用 ephemeral session，不读取或污染 durable session；
- `--max-turns 40`：限制一次 task 的最大 model turn；
- WorkBuddy 负责 task workspace、容器、verifier、日志和试次清理；Jai 不感知 benchmark id、隐藏测试或评分规则。

Desktop 不参与本次执行。它只应消费 `@jai/coding-agent` 提供的 Agent handle、状态与诊断投影，不能复制 Agent loop、工具装配、提示词或权限判定。

## 运行配置

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-08-18 |
| Benchmark | WorkBuddy-Bench Code v1.0 |
| Harness | `jai/0.0.0` |
| 模型 profile | `workbuddy/deepseek-v4-pro-ga-260813` |
| Provider | Volcengine Ark，OpenAI-compatible adapter |
| 数据集选择 | `all`（80 题） |
| Attempts | 每题 1 次 |
| 并行策略 | `SHARDS=4`，每 shard concurrency `1` |
| 最大模型轮次 | 40 |
| Session | ephemeral |

运行命令：

```bash
SHARDS=4 SHARD_CONCURRENCY=1 uv run ./scripts/run.sh \
  --job volcengine-ark-deepseek-v4-pro-jai-code-full
```

评测前，Jai CLI tarball 被重新打包并装配到 WorkBuddy harness image。此次还修复了 CLI root import 间接加载 Desktop SQLite persistence 的问题：WorkBuddy 容器使用 Node 20，而 SQLite barrel 会导致 `node:sqlite` builtin 加载失败。CLI 现在仅从 `business/layout` 导出 session layout，避免将 Desktop persistence 带进 headless runtime。

## 执行过程与基础设施恢复

### 首次全量执行

第一次全量运行创建了 80 个 trial，其中：

| 指标 | 结果 |
| --- | ---: |
| 有 verifier 结果的 trial | 59 |
| 基础设施失败 | 21 |
| 按失败 reward 为 0 计算的平均 Reward | 0.565645 |
| 已验证测试通过 | 570 / 696（81.9%） |

这 21 个错误并非 Agent 自身失败。它们都发生在 Docker Hub 拉取 `python:3.12-slim` 时，`registry-1.docker.io` 或 `auth.docker.io` 返回 EOF。为避免把外部镜像网络故障计入模型得分，先成功预拉取该镜像，再只重跑这 21 个 task；已完成的 59 题没有重复执行。

Docker 清理只执行了 dangling image prune，回收约 255.7 MB 磁盘空间；没有清理 Docker build cache 或 benchmark 仍可能使用的镜像。Docker image 占用的是磁盘而非内存。

### 定向重跑

定向 job 使用首次运行中失败的 21 个精确 task name，保持相同模型、CLI 参数、attempt 数和 shard 策略：

```bash
SHARDS=4 SHARD_CONCURRENCY=1 uv run ./scripts/run.sh \
  --job volcengine-ark-deepseek-v4-pro-jai-code-retry-infra
```

重跑结果：

| 指标 | 结果 |
| --- | ---: |
| 重跑 trial | 21 |
| 重跑基础设施错误 | 0 |
| 重跑 Reward 总和 | 15.5372 |
| 重跑平均 Reward | 0.739867 |
| 重跑测试通过 | 175 / 230 |

### 合并规则

最终 80 题结果按 `task_name` 合并：保留首次运行中 59 个正常 verifier 结果，用重跑中对应的 21 个结果替换首次运行的基础设施错误。不可按 `trial_name` 合并，因为每次运行的 suffix 会变化。

```text
59 个首次正常结果
  + 21 个重跑结果（替换首次 infra error）
  = 80 个无 infra error 的最终结果
```

本机运行产物位于 WorkBuddy workspace（不提交到本仓库）：

```text
/Users/jayden/code/workbuddy-bench-jai/results/
  volcengine-ark-deepseek-v4-pro-jai-code-full/
  volcengine-ark-deepseek-v4-pro-jai-code-retry-infra/
```

## 最终结果

### Reward 分布

| Task reward 区间 | Task 数 |
| --- | ---: |
| `1.0` | 34 |
| `[0.8, 1.0)` | 11 |
| `[0.5, 0.8)` | 20 |
| `(0, 0.5)` | 11 |
| `0` | 4 |

34 个任务完全通过，46 个任务只部分通过，说明当前系统具备稳定的端到端执行能力，但复杂契约、兼容性和安全改动的完成质量仍有明显提升空间。

### 按任务类别

| 类别 | 题数 | 平均 Reward | 测试通过 |
| --- | ---: | ---: | ---: |
| API contract | 4 | 0.426 | 21 / 50 |
| Security hardening | 4 | 0.438 | 21 / 37 |
| Bug fix | 10 | 0.542 | 24 / 41 |
| Reliability | 4 | 0.645 | 33 / 52 |
| Model evaluation | 4 | 0.662 | 35 / 53 |
| Product policy | 3 | 0.667 | 26 / 39 |
| Feature | 10 | 0.705 | 88 / 108 |
| Refactor | 4 | 0.808 | 40 / 50 |
| Repo understanding | 4 | 0.816 | 52 / 64 |
| Product analytics | 3 | 0.821 | 32 / 39 |
| Data quality | 4 | 0.827 | 43 / 52 |
| Python port | 4 | 0.882 | 72 / 81 |
| Testing | 4 | 0.963 | 48 / 50 |
| Data reporting | 4 | 1.000 | 51 / 51 |
| Feature pipeline | 4 | 1.000 | 52 / 52 |
| Performance | 4 | 1.000 | 47 / 47 |
| Schema behavior | 4 | 1.000 | 52 / 52 |
| Tool behavior | 2 | 1.000 | 8 / 8 |

弱项集中在 API contract、security hardening 和 bug fix；这三类任务共同要求 Agent 在改动前恢复既有行为契约，并在改动后证明兼容性没有被破坏。

### 按难度

| 难度 | 题数 | 平均 Reward | 测试通过 | 零分题 |
| --- | ---: | ---: | ---: | ---: |
| easy | 7 | 0.6071 | 24 / 37（64.9%） | 1 |
| medium | 31 | 0.7633 | 309 / 372（83.1%） | 1 |
| hard | 42 | 0.7828 | 412 / 517（79.7%） | 2 |

easy 平均 Reward 比 hard 低 0.176。失败与任务难度负相关，说明当前失分主要来自工作流缺陷而非模型能力上限；按难度提升模型规格不会解决这些失分。

### 零分任务样本

| Task | 结果 | 观察 |
| --- | --- | --- |
| `api_contract-hard-markup_errors` | 0 / 12 | 改动很大，但公开 API、返回结构和异常契约未被现有行为验证。 |
| `security_hardening-hard-archive_path_traversal` | 0 / 1 | 为阻止不安全 member type，错误拒绝了未显式提供 `type` 的正常 file member，破坏兼容输入。 |
| `feature-easy-lru_caching_to_tzoffset` | 0 / 4 | 只实现了部分缓存行为；`gettz.set_cache_size` 与弱引用/强缓存语义缺失。 |
| `bug_fix-medium-properly_render_double_braces` | 0 / 1 | verifier 在 pytest session setup 阶段出现 `assert pth_dir`；需在隔离环境复现以区分 task patch 影响与 verifier 假设。 |

最后一项不能仅据 score 断言为模型能力失败；它应作为后续重放和测试环境诊断对象。

## 轨迹诊断方法

以下四节的统计基于 80 个 trial 的 `result.json` 与 `agent/jai-output.jsonl`（stream-json 全量轨迹），按与主结果相同的规则合并：以 `task_name` 为键，用重跑结果替换首次运行的 21 个 infra error。

合并后统计管道复算得到 `reward = 0.75986`、`tests = 745 / 926`，与 verifier 上报值一致，可确认口径无偏差。80 个 trial 全部存在轨迹文件。

判定规则：

- **permission error**：`tool_end` 载荷匹配权限要求文案，无论是否标记 `is_error`；
- **turn**：`turn_start` 事件计数；
- **源修改**：成功的 `Edit` / `Write` / `MultiEdit`，以及写入源路径的 Bash（重定向、heredoc、`sed -i`、`patch` 等）。写入 `tmp`、`scratch` 等临时路径，以及 `rm`、`git clean` 等清理命令**不计**；
- **验证**：`pytest` / `unittest` / `tox` / `tsc` / `mypy` / `npm test` 等命令且 `exitCode == 0`；
- **只读命令**（`git diff` / `status` / `ls` / `grep` 等）既不计修改也不计验证。

初版规则曾把清理命令误判为修改，导致「未验证」被显著高估；下列数字为修正后结果。

## 运行时问题一：bypass 权限模式未真正 bypass

尽管所有 benchmark 调用都显式传入 `--permission-mode bypassPermissions`，80 份 Agent 轨迹中有 60 份出现了：

```text
Permission required for Bash; use --permission-mode
```

累计 322 次，其中 321 次发生在 `Bash`，1 次在 `Read`。

这不是 WorkBuddy 特有问题，而是 headless CLI 缺少审批兜底。

### 根因更正：判定顺序是设计意图，不是缺陷

本报告初稿判断为「`evaluatePermission()` 的 bypass 分支排在风险判定之后，无法生效」。顺序描述属实——`bashRiskDecision` 在 `packages/coding-agent/src/permissions/evaluate.ts:65`，`bypassPermissions` 的 allow 分支在 `:83`——但该顺序是有意设计：

> `docs/build-coding-agent/09-opencode-compatible-permission-system.md:154`：普通 Allow、旧 Allow、session grant、Bypass 和 Automate 行为都不能覆盖该结果。

`packages/coding-agent/test/permissions.test.ts:357` 亦将该顺序固化为测试。按初稿 P0 修改判定顺序会同时违背设计契约与现有测试。

真正的缺陷在 `app/cli/src/run.ts:223`：CLI 无条件装配了一个在 headless 下必定抛错的 approval broker。

```ts
approval: { request: requestCliApproval },        // :223 无条件装配

async function requestCliApproval(request, signal) {
    if (!input.isTTY || !output.isTTY) {          // :292
        throw new CliPermissionError({ message: `Permission required for ${request.toolName}; use --permission-mode` });
    }
```

由于该 broker 非空，`packages/coding-agent/src/permissions/middleware.ts:73` 的 `if (!options.requestApproval)` 兜底恒为 false，每条被判为 `ask` 的 Bash 命令都走到必定抛错的分支。Desktop 有 `Automate` 模式自动回 `allowOnce`，CLI 无等价实现——这是实际缺口。

### 触发面：任何重定向都被判为 destructive

`packages/coding-agent/src/permissions/rules.ts:154` 的 `hasDestructiveRedirection` 将所有重定向判为 destructive，仅豁免 `/dev/null`（`:196`）与 fd 复制 `>&N`（`:178`）。因此 `npm run build > log.txt` 这类命令同样被拦截。这是 322 次错误的主要来源。

其余 destructive 规则见 `rules.ts:132-152`：`rm`、`sudo`、`find -delete`、`git clean`、`git reset --hard`、解释器带 `-c` 等。

附带发现一处分类器漏洞：`rules.ts:148` 仅检查 `-c`，故 `python -c` 被拦而 `node -e` / `--eval` 放行。

### 该问题不影响得分

本报告初稿把此项列为 P0。轨迹统计不支持该排序：

| | 题数 | 平均 Reward |
| --- | ---: | ---: |
| 出现 permission error | 60 | 0.7575 |
| 未出现 | 20 | 0.7668 |

出现该错误的 trial 平均 Reward 反而低 0.009，属噪声量级。按 reward 区间看，322 次错误中有 120 次发生在满分题上：

| Reward 区间 | 题数 | 其中出现 permission error | 累计错误次数 |
| --- | ---: | ---: | ---: |
| `1.0` | 34 | 24 | 120 |
| `[0.8, 1.0)` | 11 | 9 | 60 |
| `[0.5, 0.8)` | 20 | 16 | 97 |
| `(0, 0.5)` | 11 | 8 | 26 |
| `0` | 4 | 3 | 19 |

`tool_behavior-easy-diagnostics_and_observability` 触发 15 次仍得 1.0。Agent 具备绕过该错误的能力，代价是额外 turn 和 token，而非最终得分。

因此该修复的收益是执行成本与轨迹整洁度，不是 Reward。它仍应修复——无人值守下 CLI 语义必须自洽——但不构成得分瓶颈，优先级下调至 P2。

## 运行时问题二：`--max-turns` 未被执行

WorkBuddy 对每个 trial 传入 `--max-turns 40`（`src/workbuddy_bench/agents/jai_agent.py:136`），实际 turn 消耗为：

| 指标 | 值 |
| --- | ---: |
| 最小 | 2 |
| 中位数 | 27.5 |
| 平均 | 37.3 |
| 最大 | **118** |

| turn 区间 | 题数 |
| --- | ---: |
| 1–5 | 1 |
| 6–10 | 9 |
| 11–20 | 20 |
| 21–30 | 12 |
| 31–37 | 5 |
| ≥38 | **33** |

33 题达到或超过 38 turn，12 题超过 60 turn。抽查耗时最长的 `refactor-hard-validation_error_paths`（118 turn）：其轨迹为 117 次 `stop_reason: tool_use` 加 1 次 `stop_reason: stop`，即模型自然结束，并非被 runtime 截断。

### 根因：harness 层丢弃了两个构造参数

链路上游全部正确：

```text
app/cli/src/run.ts:175           --max-turns -> CliOptions.maxTurns
packages/coding-agent/src/sdk.ts:365   maxTurns -> maxIterations
packages/coding-agent/src/runtime/create-coding-agent.ts:462-463   传给 harness Agent
packages/agent/src/harness/agent.ts:129                            <- 断点
packages/agent/src/core/agent.ts:120-121                           正确接收
packages/agent/src/core/agent-loop.ts:117                          检查逻辑正确
```

`packages/agent/src/harness/agent.ts:129` 构造 `CoreAgent` 时的对象字面量逐字段转发了 `model`、`provider`、`tools`、`temperature`、`maxTokens`、`toolExecution`、`session`、`instructions`，但**遗漏了 `maxIterations` 与 `providerOptions`**。因此 `agent-loop.ts:117` 的 `config.maxIterations !== undefined` 恒为 false，上限分支从不进入。

`AgentOptions` 由 `Omit<CoreAgentOptions, ...>` 派生（`harness/agent.ts:45-56`），两个字段都不在 Omit 列表中，所以调用方可以传、TypeScript 不报错、值静默丢失。

测试未覆盖该断点：`packages/agent/test/core/agent-loop.test.ts:622` 直接调用 `agentLoop()` 并手工传入 `maxIterations`，绕过 harness；`packages/agent/test/harness/` 无相关断言；`app/cli/test/run.test.ts:23` 只验证参数解析。三层测试各自覆盖链路两端，无一跨越断点。构建产物 `app/cli/dist/main.js:40011` 存在同样缺失。

### 连带影响：`providerOptions` 同样失效

`providerOptions` 与 `maxIterations` 在同一处遗漏，意味着 adapter 级请求选项在 harness 路径下不生效。

**但这不影响本次基线的 reasoning 配置。** 复核 59 份基线轨迹的 `usage.reasoning_tokens`：全部非零，合计 787154，平均每 trial 13342。原因是 reasoning 由 `JAI_PROVIDERS` 的模型定义承载（model catalog 的 `reasoning: true`），与 `providerOptions` 是两条通道。

因此基线是在 reasoning 生效的状态下产生的，修复后的结果可与之直接比较。

### turn 计数口径已确认一致

`runTurn` 一次调用等于一次 model 请求（含其触发的整批工具调用），函数开头 `agent-loop.ts:171` 恰好 emit 一次 `turn_start`。因此本报告基于 `turn_start` 的计数与 runtime 内部 `turnCount` 口径一致，118 即 118 次 model 请求，为设定值的 2.95 倍。

### 终止标记已实现，无需新建

`createIterationLimitMessage`（`agent-loop.ts:298-313`）生成 `stopReason: "iterationLimit"` 的消息，`StopReason` 联合类型已含该值（`packages/ai/src/types.ts:178`），CLI 已将其投影为 wire 上的 `iteration_limit`（`app/cli/src/run.ts:438`）。修复转发后该标记自动生效。

但 `agent_end` 事件本身不带终止原因——自然结束与上限终止发出同一个事件，该事件只有 `messages` 一个字段（`core/types.ts:84`）。消费方须回溯最后一条 assistant 消息的 `stopReason` 才能区分。

## 运行时问题三：修改后缺少验证

按「最后一次源文件修改之后是否存在成功的验证命令」统计（临时文件写入、`rm` 清理、`git clean` 不计为源修改）：

| | 题数 | 平均 Reward |
| --- | ---: | ---: |
| 最后一次修改后有成功验证 | 33 | 0.8226 |
| 无 | 46 | 0.7278 |

差值 0.095。为排除「简单任务既容易做对、也容易被跳过验证」的混淆，在每个难度层内单独比较：

| 难度 | 有验证 | 无验证 | 差值 |
| --- | ---: | ---: | ---: |
| easy | 0.7500（n=4） | 0.4167（n=3） | +0.333 |
| medium | 0.8324（n=18） | 0.7094（n=12） | +0.123 |
| hard | 0.8329（n=11） | 0.7650（n=31） | +0.068 |

三层内效应方向一致，说明关联不是难度混淆的产物。样本量小（尤其 easy 层），效应量不能直接外推，但足以支持把完成前验证列为首要修复项。

需要注意：弱项三类的未验证率并不高于其它类别。

| 类别 | 有修改的题数 | 未验证 | 平均 Reward |
| --- | ---: | ---: | ---: |
| API contract | 4 | 3（75%） | 0.4256 |
| Security hardening | 4 | 2（50%） | 0.4375 |
| Bug fix | 9 | 3（33%） | 0.5833 |
| 其余类别 | 62 | 38（61%） | 0.8374 |

其余类别未验证率 61%，高于 bug fix 的 33%，但平均 Reward 高出 0.25。**验证缺失不能解释弱项三类的低分**——完成前验证与契约恢复是两个独立问题，前者不会顺带修复后者。

### 验证广度：弱项三类的决定性差异

按是否运行过未加过滤的测试（区别于 `-k` / `::` 限定的窄验证）统计：

| 验证广度 | 全部 80 题 | 弱项三类 |
| --- | ---: | ---: |
| 运行过全量测试 | 0.7717（n=43） | 0.6202（n=10） |
| 仅窄验证 | 0.2500（n=1） | 0.2500（n=1） |
| 从未验证 | 0.7599（n=36） | 0.3452（n=7） |

全局差异 0.012，弱项三类差异 **0.275**。

### 编辑前读取既有测试：效应符号相反

统计首次 `Edit` / `Write` 之前是否读取过测试文件或运行过既有测试：

| | 弱项三类 | 其余类别 |
| --- | ---: | ---: |
| 编辑前读过 | 0.6058（n=9） | 0.7857（n=24） |
| 未读过 | 0.3796（n=9） | 0.8700（n=38） |
| 差值 | **+0.226** | **−0.084** |

同一行为在两类任务上效应符号相反。3 个零分题全部未读既有测试；4 个满分题中 3 个读过。

该结果否定「把先读测试写入全局默认 instructions」的做法——它会拖累其余 62 题。该约束必须按任务类型条件触发，而非全局强制。

### 满分题与低分题的投入几乎相同

| | turn 中位 | 输出 token 中位 | 耗时中位 | 修改次数中位 | 验证率 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 满分 34 题 | 26 | 14460 | 340.5s | 4.5 | 50.0% |
| 低分（&lt;0.5）15 题 | 27 | 13135 | 340.2s | 6.0 | 26.7% |

低分并非投入不足。turn、token、耗时、修改次数四项基本一致，唯一系统性差异是验证率。

## 运行时问题四：受阻后静默降级

15 个 Reward &lt; 0.5 的 run 中，仅 4 个在 final response 中提及任何困难、阻塞或未完成事项；其余 11 个（含 3 个零分题）以正常交付语气结束。

零分题 `api_contract-hard-markup_errors` 的 final response 声明：

```text
验证：`python -m unittest discover -s tests -v` 全部通过（12 个测试）
```

该命令运行的是 Agent 自建的测试，而 verifier 的 12 个断言全部失败。陈述本身不假，但它证明的是 Agent 自己的假设，而非既有公开契约。这与「问题三」互为补充：不仅要求验证发生，还要求验证对象是仓库已有的测试。

对无人值守调用方而言，一个明确报告「被阻塞、未完成」的低分 run，比一个正常结束的同分 run 有用得多。当前 runtime 不产出这类信号。

### 自我报告与真实完成度负相关

按 final response 是否声称测试通过分组：

| | 题数 | 平均 Reward | 其中实际 &lt; 0.5 |
| --- | ---: | ---: | ---: |
| 声称通过 | 21 | **0.6869** | 6 |
| 未声称 | 59 | **0.7858** | 9 |

声称测试通过的一组平均 Reward 反而低 0.099。其中 6 题声称通过而实际低于 0.5：

| Task | Reward | 成功验证次数 |
| --- | ---: | ---: |
| `api_contract-hard-markup_errors` | 0.000 | 4 |
| `feature-easy-lru_caching_to_tzoffset` | 0.000 | 5 |
| `bug_fix-easy-filtered_relation_queryset_arg` | 0.250 | 0 |
| `bug_fix-medium-permission_error_skip_continue` | 0.250 | 5 |
| `feature-medium-etag_header_for_static` | 0.273 | 10 |
| `api_contract-hard-validation_errors` | 0.286 | 2 |

`feature-medium-etag_header_for_static` 运行了 10 次成功验证并声称通过，实际仅 0.273。自我报告的完成度不能作为完成信号使用。

### 根因：默认 instructions 对完成前验证无要求

`packages/coding-agent/src/runtime/default-instructions.ts` 全文仅 4 段：通用角色、减少工具调用叙述、browser 任务使用 `agent-browser`、UpdateTodos 使用规则。

其中两处相关表述作用域均受限：

- 「report the capability blocker rather than claiming...」只针对 browser 场景；
- 「Mark an item completed only after its required verification succeeds... keep it in_progress or mark it cancelled instead of claiming completion」只约束 Todo 条目状态，不约束 final response，且仅在 Agent 使用了 UpdateTodos 时才有意义。

没有任何针对代码修改的通用约束。这解释了数据表现：Agent 在 Todo 语境下遵守验证纪律，在交付 final response 时不遵守。

## 运行时问题五：Bash 承担了一半的文件写入

| 写入方式 | 次数 | 占比 |
| --- | ---: | ---: |
| `Edit` / `Write` / `MultiEdit` | 316 | 51.0% |
| Bash（重定向、heredoc、`sed -i` 等） | 304 | **49.0%** |

| | 题数 | 平均 Reward |
| --- | ---: | ---: |
| 重度使用 Bash 写文件（≥3 次） | 26 | 0.6913 |
| 完全不用 Bash 写文件 | 18 | 0.7823 |

该问题与「问题一」互为放大：Bash 写文件必然带重定向或 heredoc，必然触发权限层的 `ask`。修复 headless 审批后应重新测量——部分 Bash 写入可能是结构化工具受阻后的退化选择，而非模型偏好。

## 工具错误分类

工具调用总数 3328，错误 486，错误率 **14.6%**。

| 分类 | 次数 | 占比 |
| --- | ---: | ---: |
| permission | 317 | 65.2% |
| other（多为测试失败输出等正常结果） | 136 | 28.0% |
| file_not_found（含 `ruff: not found`） | 15 | 3.1% |
| bad_tool_args | 15 | 3.1% |
| timeout | 3 | 0.6% |

权限错误占全部工具错误的三分之二，是最大的单一噪声源——尽管它不影响最终得分。

## 框架能力缺口

除上述具体缺陷外，runtime 当前无法表达「未完成 / 被阻塞」，缺口横跨三层：

**数据层**：`CodingRunResult`（`packages/coding-agent/src/sdk.ts:233-237`）只有 `sessionId`、`messages`、`state` 三个字段，无 run 级 stop reason、无工具错误统计、无 mutation 或验证记录。`CodingAgentState.status` 仅有 `idle | running | aborted | closed`，且 `aborted` 由 `state.error` 判定，自然结束与到达 turn 上限一律为 `idle`。工具错误的 `TaggedError` `_tag` 在 `agent-loop.ts:430-438` 被 `getErrorMessage()` 丢弃，只保留 `isError: boolean` 与一段文本；`AgentToolResult.details`（含 `exitCode`、`durationMs`）在错误路径根本不填写。本报告的诊断只能靠正则扫描轨迹文本反推，正是该缺口的直接后果。

**控制层**：`getFollowUpMessages`（`core/types.ts:137-141`）的语义正是「agent 本该停下时调用，有消息则继续新一轮」，恰好是完成前验证所需的注入点，但当前只接了一个纯手工队列（`core/agent.ts:349`），无任何 runtime 逻辑自动入队。`AgentHookMap`（`harness/hooks.ts:76-89`）的 6 类 hook 中没有可否决结束的 hook，`onEvent` 为纯观察者且返回值被丢弃。

注意区分：`getSteeringMessages` 在每个 turn 之间注入（`agent-loop.ts:149`），不是结束点，不适用于此。

**提示层**：见「问题四」根因。

## 框架优化结论

优化必须落在 `@jai/coding-agent` runtime，而非 WorkBuddy harness 或 Desktop。以下排序依据「轨迹诊断」的实测数据，与本报告初稿不同：

| 优先级 | 改动 | 所属层 | 验收 |
| --- | --- | --- | --- |
| P0 | harness 转发 `maxIterations` 与 `providerOptions` | `packages/agent/src/harness/agent.ts:129` | 一行遗漏；补 harness 层测试。turn 上限生效后 `iteration_limit` 自动出现。 |
| P0 | headless 审批兜底 | `app/cli/src/run.ts:288` | 无 TTY 且 `bypassPermissions` 时返回 `allowOnce` 而非抛错；硬熔断不受影响。 |
| P0 | 加入完成前验证模块 | coding-agent runtime | 接管 `getFollowUpMessages`；发生修改后无成功验证不得自然结束；最多注入一次提醒。 |
| P1 | 受阻与未完成必须上报 | run result / final response | 存在未解决工具错误、失败验证或未验证 mutation 时标记未完成，final response 明示 blocker。 |
| P1 | 契约恢复工作流 | instructions + runtime steering | **按任务类型条件触发**，不作为全局默认。 |
| P2 | 结构化文件工具作为默认编辑路径 | instructions / tools | 修复 headless 审批后重新测量再决定力度。 |
| P2 | 补 `node -e` / `--eval` 风险识别 | `permissions/rules.ts:148` | 与 `python -c` 对齐。 |
| P3 | provider/tool-call 微型回归评测 | provider adapter 测试 | 覆盖多行 Bash、引号、工具结果后继续推理、流式输出和终止。 |
| P3 | run diagnostics | SDK run result / canonical event | 保留工具错误 `_tag`、错误路径填 `details`、聚合 permission decision、mutation、验证证据、终止原因、turn 消耗。 |

优先级变更说明：

- 原 P0（权限判定顺序）根因判断有误，实际缺陷在 CLI 审批兜底；且实测与 Reward 无相关，收益是成本而非得分；
- turn 预算失效为新增项，根因是一行传参遗漏，修复成本最低、收益最直接；
- 原 P1（完成前验证）上调至 P0——层内效应一致，是当前可验证的最大得分杠杆；
- 「受阻上报」为新增项，覆盖自我报告与真实完成度负相关的问题；
- 原 P2（契约恢复）上调至 P1，且经数据确认必须条件触发，全局强制会拖累其余类别。

### P0：harness 参数转发

`packages/agent/src/harness/agent.ts:129` 的 `new CoreAgent({...})` 补上 `maxIterations` 与 `providerOptions`。

配套：

- 将两个字段移出 `AgentOptions` 的 `Omit` 派生，或增加 harness 层转发测试，防止同类静默丢失复发；
- 增加 harness 层用例：设定 `maxIterations: 3` 时循环在第 3 个 model turn 后终止，末条消息 `stopReason` 为 `iterationLimit`；
- 修复后 `providerOptions` 开始生效，但它不承载 reasoning（reasoning 走 model catalog，基线已验证生效），因此基线仍可用作对照。

### P0：headless 审批兜底

不改 `evaluate.ts` 的判定顺序（该顺序由设计文档与测试固化）。在 `app/cli/src/run.ts:288` 的 `requestCliApproval` 中，无 TTY 且当前模式为 `bypassPermissions` 时返回 `allowOnce`，对齐 Desktop 的 `Automate` 语义。

硬熔断（`evaluate.ts:53` 的 root/home 删除）走 deny 分支、不创建审批请求，因此不受影响。

至少增加以下测试：

- 无 TTY + `bypassPermissions` 下 `echo value > output.txt`、heredoc、`python -c` 不抛 `CliPermissionError`；
- `rm -rf /`、`rm -rf ~`、`rm -rf $HOME` 仍为 deny；
- CLI 非 TTY E2E：完成一次编辑与测试，不产生 permission error。

### P0：完成前验证模块

不要只通过 system prompt 要求「运行测试」。应把这一行为收敛为 runtime 内部的深模块：接口小，负责记录本轮是否发生 mutation、之后是否出现成功的验证命令、是否已经注入过验证提醒。

**接入点**：`getFollowUpMessages`（`packages/agent/src/core/types.ts:137-141`，循环侧 `agent-loop.ts:153`），其语义正是「agent 本该停下时调用，有消息则继续新一轮」。当前它只接了一个手工队列（`core/agent.ts:349`），没有任何 runtime 逻辑自动入队，需要由该模块接管。

不要使用 `getSteeringMessages`——它在每个 turn 之间注入（`agent-loop.ts:149`），不是结束点。

建议行为：

1. 监测 `Edit`、`Write` 以及写入源文件的 `Bash` 成功执行，标记 workspace 为 dirty。临时文件写入与清理命令不计；
2. 监测成功的 test/build/typecheck/compile 命令，记录其在最后一次 mutation 之后的证据；
3. Agent 准备自然结束而 workspace dirty 且没有证据时，注入一次 follow-up：要求运行仓库已有的相关验证；
4. 若验证失败，要求 Agent 处理失败或明确报告 blocker，不能把失败当成功；
5. 如果仓库没有可运行验证，允许明确报告，但该事实必须进入 run diagnostics。

两条由数据得出的设计约束：

- **验证必须以仓库既有测试为准**。`api_contract-hard-markup_errors` 自建测试全绿而 verifier 12 个断言全灭；仅运行 Agent 自建测试不能计为契约验证，诊断需区分两者。
- **不要只要求「最小相关验证」**。弱项三类中运行过全量测试的为 0.6202，从未验证的为 0.3452，而仅做窄验证（`-k` / `::` 限定）的样本 Reward 为 0.2500。窄验证不足以证明兼容性未被破坏。

CLI 只传配置和序列化结果；Desktop 只展示诊断；两者都不应自行实现这套状态机。

### P1：受阻与未完成上报

验证模块记录的状态必须影响终态，而不只是内部标记：

1. 存在未解决的工具错误、失败的验证、或已识别但未实现的需求时，run result 标记为未完成；
2. final response 必须明示 blocker，不得以正常交付语气结束；
3. 「验证」以仓库已有测试为准；仅运行 Agent 自建测试不计为契约验证，需在诊断中区分两者。

第 3 条针对 `api_contract-hard-markup_errors`：该 run 自建测试全绿、verifier 12 个断言全灭，final response 未提示任何风险。

### P1：契约恢复与兼容性

对 API、安全和 bug fix 任务，默认工作流必须先恢复既有契约，而非直接按任务文字实现一个看似合理的新版本：

- 先读现有测试、public exports、类型、调用点和默认行为；
- 列出必须保持的合法输入、默认值、返回结构和异常字段；
- security hardening 同时验证「恶意输入被拒绝」与「原有正常输入仍可用」；
- 运行仓库已有测试，且不加过滤；新增 regression test 不能代替已有测试；
- 完成前执行 `git diff --check` 与相关的全量测试。

**该约束必须条件触发，不能写入全局默认 instructions。** 「编辑前读既有测试」在弱项三类上效应为 +0.226，在其余类别上为 −0.084。全局强制会拖累其余 62 题。触发条件可依据任务涉及的是否为 public API、既有异常契约或安全边界，而非任务分类标签本身（runtime 不感知 benchmark 分类）。

archive task 的失败正是缺少「正常输入仍可用」的回归验证；markup task 则说明仅增加自定义测试不足以证明公共契约正确。

### P2：Bash 风险分类补漏

`packages/coding-agent/src/permissions/rules.ts:148` 的解释器判定只检查 `token === "-c"`，因此 `python -c 'code'` 被判为 destructive，而 `node -e 'code'` / `--eval` 放行。两者风险等价，应对齐。

注意这会**增加**被拦命令的数量，因此必须在 headless 审批兜底（P0）落地之后再做，否则会放大 permission error。

权限模式本身不需要其它改动：判定顺序由设计文档与测试固化，headless 缺口已由 P0 覆盖。

### P3：工具使用与可观测性

默认 instructions 目前偏通用，未给出完成质量约束。应补充：

- 先检索再编辑；
- 直接用结构化 `Edit` / `Write` 修改源码；
- Bash 用于执行、检查和验证，而不是成为默认的文件编辑器；
- 不要在未查看已有测试前，仅创建一套验证自身假设的新测试；
- final response 之前检查 diff 和验证结果。

SDK 还应输出稳定、可聚合的 run diagnostics，而不是让 benchmark 只能扫描自然语言工具错误。建议至少包含：permission decision、tool error 分类、mutation count、verification evidence、终止原因、model latency 和 usage。Desktop 可将其投影为 UI；CLI 可投影为 stream-json；这不是 Desktop business event。

## 后续验证计划

> 阶段一已执行，结果见 `workbuddy-code-weak-slice-2026-08-19.md`：四项修复的机制指标全部达标（permission error 与 turn 溢出归零，工具错误率 13.8% → 7.1%），但 Reward 无显著变化，且实测单题极差最高达 1.00，说明 3 attempts 仍不足以测出 ±0.05 量级的效应。验证提醒被正确注入但未改变模型行为，需要重新设计。

### 阶段一：P0 回归与弱项切片

完成两项 P0（turn 预算、完成前验证）后，先运行 API contract、security hardening、bug fix 三类的 18 个唯一任务；每题执行 3 attempts，以降低单次模型波动。

必须对比：

- 平均 Reward 和测试通过率；
- turn 消耗分布与 turn limit 终止数（目标：无超出设定值的 run）；
- 有 mutation 但未验证的 run 数量（目标为 0）；
- 低分 run 中明示 blocker 的比例（当前基线 4/15）；
- permission error 数量（P2 完成后目标为 0，除硬熔断外）；
- 每题耗时与 token 用量。

由于 easy 层平均 Reward 低于 hard 层，切片结果还须按难度分层报告，不能只给类别均值。

### 阶段二：P1 后的完整回归

弱项切片达到稳定改善后，使用同一 provider profile 和同一 CLI 参数重跑完整 Code 80 题。报告必须同时给出 task-level reward、tests passed、infra error、attempt 数、难度分层和结果合并规则；不得只报告单一平均分。

### 阶段三：provider 对照

在 runtime 问题修复后，再比较模型或 provider adapter。每个候选至少使用同一弱项切片；不要让不同权限模式、不同 max turns 或不同 Docker 镜像状态混入模型对比。

## 已知限制

- 本次每题仅 1 attempt，结果是重要的基线但不是统计显著的模型排名；
- 首次全量运行包含 Docker Hub EOF，最终成绩已通过精确重跑消除该基础设施影响；
- `bug_fix-medium-properly_render_double_braces` 的 verifier setup error 需要单独复现；
- 轨迹诊断的分层样本很小（easy 层仅 7 题，弱项三类各 3–4 题），效应方向可信，效应量不可外推；
- 「修改」与「验证」由工具调用与命令模式识别得出，非 runtime 原生诊断字段。识别规则已排除临时文件写入与清理命令，但仍可能存在边界误判；run diagnostics 落地后应改用 runtime 输出重新统计；
- turn 计数口径已确认与 runtime `turnCount` 一致（见「运行时问题二」）；
- `providerOptions` 在 harness 路径下同样被丢弃，但它不承载 reasoning：复核 59 份基线轨迹的 `reasoning_tokens` 全部非零（合计 787154），说明 `JAI_PROVIDERS` 模型定义中的 `reasoning: true` 已生效。基线可作为修复后的对照；
- 结果基于 2026-08-18 当天的本地 Jai 工作树、WorkBuddy task image 和 Ark 模型 profile；代码或镜像变化后不能直接横向比较；
- 本报告不包含 API token、provider credential 或其他机密配置。

## 决策

将 `0.75986` 作为当前 Jai + Ark DeepSeek v4 Pro 的 WorkBuddy Code 基线。轨迹诊断表明主要失分来自 runtime 工作流缺陷而非模型能力上限——easy 层得分低于 hard 层，且满分题与低分题的 turn、token、耗时、修改次数基本一致。

下一步不是扩展 Desktop，也不是为 WorkBuddy 添加专有能力，而是：

1. 补上 `packages/agent/src/harness/agent.ts:129` 遗漏的 `maxIterations` 与 `providerOptions`，并补 harness 层测试；
2. 在 `app/cli/src/run.ts:288` 增加 headless 审批兜底，不改动权限判定顺序；
3. 接管 `getFollowUpMessages`，实现完成前验证模块；
4. 让受阻与未完成进入 run result 与 final response，禁止静默降级；
5. 实现条件触发的契约恢复约束，并单独衡量其对 API contract / security hardening / bug fix 的影响；
6. 用弱项切片验证收益后重跑全量 80 题；
7. 仅在上述 runtime 基线稳定后再评估模型和 provider adapter 的变化。
