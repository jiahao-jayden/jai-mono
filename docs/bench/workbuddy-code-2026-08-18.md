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

这次评测同时发现一个会直接影响无人值守 CLI 的 runtime 缺陷：已传入 `--permission-mode bypassPermissions` 时，复杂 Bash 写入命令仍会被要求人工确认；在 WorkBuddy 的无 TTY 环境中，它被转换为工具错误。该问题比更换模型或为 benchmark 加特制 prompt 更应优先修复。

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

### 零分任务样本

| Task | 结果 | 观察 |
| --- | --- | --- |
| `api_contract-hard-markup_errors` | 0 / 12 | 改动很大，但公开 API、返回结构和异常契约未被现有行为验证。 |
| `security_hardening-hard-archive_path_traversal` | 0 / 1 | 为阻止不安全 member type，错误拒绝了未显式提供 `type` 的正常 file member，破坏兼容输入。 |
| `feature-easy-lru_caching_to_tzoffset` | 0 / 4 | 只实现了部分缓存行为；`gettz.set_cache_size` 与弱引用/强缓存语义缺失。 |
| `bug_fix-medium-properly_render_double_braces` | 0 / 1 | verifier 在 pytest session setup 阶段出现 `assert pth_dir`；需在隔离环境复现以区分 task patch 影响与 verifier 假设。 |

最后一项不能仅据 score 断言为模型能力失败；它应作为后续重放和测试环境诊断对象。

## 关键运行时问题：bypass 权限模式未真正 bypass

尽管所有 benchmark 调用都显式传入 `--permission-mode bypassPermissions`，本次运行的 60 份 Agent 轨迹中仍出现了：

```text
Permission required for Bash; use --permission-mode
```

这不是 WorkBuddy 特有问题，而是通用 CLI/runtime 语义错误：

1. `evaluatePermission()` 先运行 Bash destructive/opaque 风险判定；
2. 对 heredoc、重定向、复杂 `python -c` 等命令，风险判定返回 `ask`；
3. `bypassPermissions` 的 allow 分支在该判断之后，无法生效；
4. headless CLI 的 approval broker 没有 TTY，只能抛出上述错误；
5. 模型收到错误后常尝试猜测不存在的工具参数或替代 shell 写法，浪费 turn 并停止真正的修复工作。

涉及的实现位置：

- `packages/coding-agent/src/permissions/evaluate.ts`
- `packages/coding-agent/src/permissions/middleware.ts`
- `app/cli/src/run.ts`

`bypassPermissions` 的合理语义应是：在调用方明确选择该模式时，跳过所有可询问的 permission 决策；唯一保留的不可绕过约束是删除 filesystem root、home root 等硬熔断。它不能因为 Bash parser 判为 opaque 就退化为交互确认。

## 框架优化结论

优化必须落在 `@jai/coding-agent` runtime，而非 WorkBuddy harness 或 Desktop：

| 优先级 | 改动 | 所属层 | 验收 |
| --- | --- | --- | --- |
| P0 | 修正 `bypassPermissions` 的判定顺序 | permission runtime | 非 TTY 下普通写入、heredoc、重定向和 `python -c` 可执行；root/home 删除仍拒绝。 |
| P1 | 加入完成前验证模块 | coding-agent runtime | 发生修改后，Agent 无成功验证不能自然结束；最多注入一次验证提醒，避免无限循环。 |
| P2 | 强化契约恢复工作流 | default instructions + runtime steering | 编辑前读取现有测试、类型和调用点；明确保留合法输入、默认值、返回与异常结构。 |
| P3 | 将结构化文件工具作为默认编辑路径 | coding-agent instructions / tools | 源码修改优先 `Read` / `Edit` / `Write`，Bash 用于搜索、测试、构建与 diff。 |
| P4 | 增加 provider/tool-call 微型回归评测 | provider adapter 测试 | 覆盖多行 Bash、引号、工具结果后继续推理、流式输出和终止。 |
| P5 | 增加可聚合运行诊断 | SDK canonical event / run result | 可统计 permission block、工具错误、修改后是否验证、iteration limit、模型耗时与失败原因。 |

### P0：权限模式修复

实现原则：

```text
不可绕过硬熔断（root/home destructive delete）
  -> bypassPermissions 则 allow
  -> 其余风险分类、规则匹配与 approval 流程
```

至少增加以下测试：

- `bypassPermissions` 下 `echo value > output.txt` 为 allow；
- `bypassPermissions` 下 heredoc、重定向、`python -c` 为 allow；
- `rm -rf /`、`rm -rf ~`、`rm -rf $HOME` 仍为 deny；
- CLI 非 TTY E2E：用 `--permission-mode bypassPermissions` 完成一次编辑与测试，不产生 permission error。

这项修复是 CLI 的正常产品语义，不是 benchmark 定制。

### P1：完成前验证模块

不要只通过 system prompt 要求“运行测试”。应把这一行为收敛为 runtime 内部的深模块：接口小，负责记录本轮是否发生 mutation、之后是否出现成功的验证命令、是否已经注入过验证提醒。

建议行为：

1. 监测 `Edit`、`Write` 以及非只读 `Bash` 成功执行，标记 workspace 为 dirty；
2. 监测成功的 test/build/typecheck/compile 命令，记录其在最后一次 mutation 之后的证据；
3. Agent 准备自然结束而 workspace dirty 且没有证据时，注入一次 synthetic steering：要求找到并运行最小相关的现有验证；
4. 若验证失败，要求 Agent 处理失败或明确报告 blocker，不能把失败当成功；
5. 如果仓库没有可运行验证，允许明确报告，但该事实必须进入 run diagnostics。

CLI 只传配置和序列化结果；Desktop 只展示诊断；两者都不应自行实现这套状态机。

### P2：契约恢复与兼容性

对 API、安全和 bug fix 任务，默认工作流必须先恢复既有契约，而非直接按任务文字实现一个看似合理的新版本：

- 先读现有测试、public exports、类型、调用点和默认行为；
- 列出必须保持的合法输入、默认值、返回结构和异常字段；
- security hardening 同时验证“恶意输入被拒绝”与“原有正常输入仍可用”；
- 优先运行仓库已有的 focused test；新增 regression test 不能代替已有测试；
- 完成前执行 `git diff --check` 和最小相关 test。

archive task 的失败正是缺少“正常输入仍可用”的回归验证；markup task 则说明仅增加自定义测试不足以证明公共契约正确。

### P3：工具使用与可观测性

默认 instructions 目前偏通用，未给出完成质量约束。应补充：

- 先检索再编辑；
- 直接用结构化 `Edit` / `Write` 修改源码；
- Bash 用于执行、检查和验证，而不是成为默认的文件编辑器；
- 不要在未查看已有测试前，仅创建一套验证自身假设的新测试；
- final response 之前检查 diff 和验证结果。

SDK 还应输出稳定、可聚合的 run diagnostics，而不是让 benchmark 只能扫描自然语言工具错误。建议至少包含：permission decision、tool error 分类、mutation count、verification evidence、终止原因、model latency 和 usage。Desktop 可将其投影为 UI；CLI 可投影为 stream-json；这不是 Desktop business event。

## 后续验证计划

### 阶段一：P0 回归与弱项切片

完成 P0 后，先运行 API contract、security hardening、bug fix 三类的 18 个唯一任务；每题执行 3 attempts，以降低单次模型波动。

必须对比：

- 平均 Reward 和测试通过率；
- permission error 数量（目标为 0，除硬熔断外）；
- 有 mutation 但未验证的 run 数量；
- iteration limit、工具错误和 provider error；
- 每题耗时与 token 用量。

### 阶段二：P1/P2 后的完整回归

弱项切片达到稳定改善后，使用同一 provider profile 和同一 CLI 参数重跑完整 Code 80 题。报告必须同时给出 task-level reward、tests passed、infra error、attempt 数和结果合并规则；不得只报告单一平均分。

### 阶段三：provider 对照

在 runtime 问题修复后，再比较模型或 provider adapter。每个候选至少使用同一弱项切片；不要让不同权限模式、不同 max turns 或不同 Docker 镜像状态混入模型对比。

## 已知限制

- 本次每题仅 1 attempt，结果是重要的基线但不是统计显著的模型排名；
- 首次全量运行包含 Docker Hub EOF，最终成绩已通过精确重跑消除该基础设施影响；
- `bug_fix-medium-properly_render_double_braces` 的 verifier setup error 需要单独复现；
- 结果基于 2026-08-18 当天的本地 Jai 工作树、WorkBuddy task image 和 Ark 模型 profile；代码或镜像变化后不能直接横向比较；
- 本报告不包含 API token、provider credential 或其他机密配置。

## 决策

将 `0.75986` 作为当前 Jai + Ark DeepSeek v4 Pro 的 WorkBuddy Code 基线。下一步不是扩展 Desktop，也不是为 WorkBuddy 添加专有能力，而是：

1. 修复 `bypassPermissions` 的 runtime 语义并补齐 CLI E2E；
2. 在 `@jai/coding-agent` 实现完成前验证与契约恢复约束；
3. 用弱项切片验证收益后重跑全量 80 题；
4. 仅在上述 runtime 基线稳定后再评估模型和 provider adapter 的变化。
