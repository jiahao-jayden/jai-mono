# Frontier local smoke runner：计划

状态：⚠️ 已实现；真实 agent trial 等待可强制磁盘配额的 Docker backend  
日期：2026-09-03

## 一、背景与约束

`frontier-harness-eval` 公共仓库在固定提交
`0c402ae23724e2d937df0c7038b82203a829a385` 提供任务描述和 `task.toml`，不提供官方
runner、checkpoint 或 verifier。因而本计划的产物是可审计的本地 smoke evidence，而不是
官方 benchmark score。

JAI 当前路径是 `jai CLI → Server ACP Runtime Host → Coding Agent`。在本分支，CLI 已有
`--model`、`--mode` 和 `stream-json` 最终事件，可把 selected model/mode 配置和结束原因、
工具调用计数、成本、耗时投影给 runner。该 runner 不承担或复制 Server/Coding Agent 语义。

目前 Docker 客户端可用，但本机 Docker daemon / OrbStack socket 不可连接。这是第一个真实
trial 的外部前置条件；计划中的 Docker E2E 必须显式启用，不能在 daemon 不可用时降级为宿主
执行。

## 二、方案概览

增加一个 `frontier-smoke` 领域工具，负责三件事：理解公开 task definition、搭起一次性
隔离运行环境、投影 trial 结果。它在容器中调用现有 CLI；CLI 仍使用 Server ACP。

```
public task.toml + instruction.md
              │
              ▼
      frontier-smoke orchestration
       ├─ validates limits / packages CLI runtime
       ├─ starts task container on internal-only network
       ├─ starts provider gateway on internal + egress networks
       └─ writes safe trial-result JSON + evidence references
              │
              ▼
task container: jai CLI → Server ACP → Coding Agent
              │  (only internal gateway endpoint)
              ▼
provider gateway → explicitly allowlisted model upstream
```

第一版只执行单 task、单 trial、单 model。首个真实 E2E 使用 `build-cython-ext`，但在能够确认
该任务镜像与 JAI Linux runtime 的可执行性前，不声称其可运行。

## 三、外部契约

工具以一个明确的 `run` 动作接收：任务目录、模型标识、受控 gateway 配置、用户指定的结果
目录及可选的 agent turn 上限。它拒绝任务根目录外的路径、缺失必需文件、未知/不能强制的
task 约束和不安全输出目录。

一次成功启动的 trial 产出：

- task 名称、固定上游 revision、task definition 摘要和所应用限制；
- 状态：完成、agent 失败、超过时间、setup/隔离失败或证据收集失败；
- CLI 最终投影：stop reason、tool call/error 计数、总成本和 agent duration；
- 容器总耗时、退出状态、有限的安全日志引用、工作区 patch/digest（可获取时）；
- 网络策略标识 `model-gateway-only` 与 runtime/package 版本信息。

它不会把 API key、完整宿主配置、stack、cause、未筛选的 provider/Docker 原始错误或 CLI
stream 原样写入结果。业务可恢复错误使用 `Result`，领域失败使用
`frontier_smoke.<reason>` TaggedError；跨进程/落盘边界仅投影白名单 DTO。

## 四、工作拆分

### Work 1：任务定义和可移植 CLI runtime 边界

实现任务读取/校验以及可在 Linux task image 中执行现有 CLI 的包装 preflight。任务定义只接受
本次公开格式所需字段，明确记录尚未支持的字段；镜像、CPU、内存、磁盘、时限、网络要求会
被转换为一个不可变 trial plan。包装方案必须先在目标 Docker 平台证明 CLI、Server 和其运行时
都能在 task image 中启动，不能假设任务镜像自带 Node/Bun。

详见 [Spec 01](specs/01-task-contract-and-cli-runtime.md)。

### Work 2：内部模型网关和容器隔离

建立双网络拓扑。任务容器连接 internal-only network；gateway 同时连接该网络和 egress network。
临时 Server 配置仅指向 gateway，并使用无上游密钥的内部认证方式；真正上游 key 只由 gateway
持有。所有 Docker 限制必须实际映射或在启动前失败，尤其磁盘限制不允许静默忽略。

详见 [Spec 02](specs/02-isolated-gateway-and-trial-environment.md)。

### Work 3：单 trial 编排、证据和首个 Docker smoke

按固定生命周期创建 trial、运行 CLI、收集投影、导出工作区证据并 finally 清理所有一次性
资源。纯测试覆盖契约和失败投影；Docker E2E 受显式环境开关保护，验证 `build-cython-ext` 的
真实运行路径及禁止 direct egress 的断言。

详见 [Spec 03](specs/03-trial-orchestration-and-evidence.md)。

## 五、六类问题检查

| 维度 | 处理方式 |
| --- | --- |
| Durable facts | 不新增 JAI durable fact；每次 trial 的结果是用户指定结果目录下的输出工件，不写 journal。临时 `JAI_HOME`、容器、网络与凭据均为短生命周期。 |
| External systems | 上游任务仓库只作只读输入；Docker 和 provider gateway 是 adapter。缺少 daemon、镜像、可执行 runtime 或约束支持时 fail closed。 |
| User interactions | 面向终端给出阶段性进度、trial ID 与结果路径；正常失败返回稳定安全 DTO/非零状态，配置和密钥从不回显。 |
| Health / lifecycle | 资源创建后立即登记 cleanup；收到中断、超时和 CLI 失败都执行逆序清理。gateway 就绪后才启动 task，不能启动则停止 trial。 |
| Observability | 结果保留 task/model 的非秘密标识、限制、生命周期时间、CLI 白名单指标、容器退出分类和证据 digest；原始敏感流只保留在临时受限位置并随 trial 清理。 |
| Concurrency | 第一版每个进程只允许一个 trial。所有临时资源有 trial ID 前缀，避免清理到用户现有容器/网络；并发矩阵属于后续能力。 |

## 六、关键决策

1. **CLI 是被测入口，Server 是实际 agent runtime。** runner 只调用 CLI，故能同时覆盖 CLI 的
   ACP client 行为和 Server 的配置/执行路径。
2. **gateway 注入上游认证，而不是把密钥配给 Agent。** 任务内 Server 仅知 internal gateway
   URL；即使 Agent 有 shell 工具，也不能得到上游 credential 或宿主 `~/.jai`。
3. **隔离不能降级。** `allow_internet=false` 与模型调用冲突由双网络解决；若 Docker 无法表达
   task 所需的磁盘/平台约束，则 setup error，而不是改为 `--network=bridge` 或在宿主运行。
4. **先证明 runtime packaging。** 当前 Agent execution environment 是本地 Node runtime，公开
   task image 不保证含有兼容 Node/Bun。因此先做 Linux packaging preflight，再接 task E2E。
5. **结果是 projection，不是评分。** 无 verifier 时写 evidence 和客观运行状态，绝不把
   “进程退出 0”标成 benchmark pass。

## 七、明确不选的方案

- 新的 Server ACP benchmark adapter：和现有 CLI ACP client 重复，增加被测路径分叉。
- 直接 mount `~/.jai`：任务可接触持久 SQLite、所有 profile 和密钥，且污染 host session/config。
- task container 直连公网：违反选定网络模型，难以复现实验边界。
- Docker daemon 不可用时本机执行：测到的不是 task image，也违反 task 资源/网络定义。
- 自制 verifier 或基于 git diff 的 “pass” 结论：没有上游判定规则时不具有效力。

## 八、风险与处理

| 风险 | 处理 |
| --- | --- |
| Docker daemon 当前不可连接 | 实现前/试跑前做 preflight，给出启动 OrbStack/Docker 的可操作失败；CI/单元测试不依赖 daemon。 |
| task image 不带 Node/Bun 或架构不兼容 | Work 1 产出可移植 CLI runtime 的明确 packaging contract；不能证明即停止，不进入真 trial。 |
| Docker Desktop 对 per-container disk quota 支持不一致 | 探测 Docker storage driver/能力；不能强制就 setup 失败并记录，而非假装已满足。 |
| gateway 破坏 streaming 或 provider 协议 | 对选定 provider 做 health/stream preflight，保留 HTTP/SSE 所需语义，失败不启动 task。 |
| 上游没有 verifier | 结果字段明确为 `smoke` / `execution evidence`，文档和 CLI 均不使用 `score` 或 `pass rate`。 |
| prompt/tool 可试图读容器内文件 | Agent 只可见 task workspace 与无密钥 runtime 配置；gateway key 不进入 task filesystem/environment，容器不挂载宿主配置。 |

## 九、必须遵守的项目规则

- runner 按领域/角色拆分为 core、runtime、Docker/gateway adapters 和 result projection；composition
  root 不放任务规则或 Docker 协议。
- CLI/Desktop/runner 不能重实现 Agent、session 或 permission 语义；仍通过 CLI→Server ACP。
- 可恢复失败用 `better-result`；错误 `_tag` 使用 `frontier_smoke.<reason>`；跨边界只传安全 DTO。
- 不为不可用环境加入 fallback、双写或兼容层；不新增 journal/JSONL durable state。
- 首先复用已有 CLI 和 Server configuration seam；需要新依赖前先检查 workspace，采用成熟维护的库。
- 任何 cleanup 只操作由本 trial 创建、名称含准确 trial ID 的 Docker 资源。

## 十、验证计划

实现后按风险自低到高验证：

1. 新工具的 task TOML 解析、限制映射、结果投影、错误 DTO 与 cleanup registry 单元测试。
2. 新工具的类型检查和测试脚本；已有 `app/cli` 的 `bun run typecheck`、`bun test`，以及
   `CLI_E2E=1 bun test test/provider-e2e.test.ts --timeout 60000` 回归。
3. `app/server` 的 `bun run typecheck` 与 `bun test`，确认 runner 没有改变 runtime 语义。
4. Docker daemon 可用时，显式开启的 `build-cython-ext` 单 trial E2E：检查 task 无 direct egress、
   gateway 可通模型、CLI final projection 被采集、资源均被清理。
5. 对改动文件运行格式/静态检查和 `git diff --check`；人工审查结果中不存在 key、stack、cause
   或未投影 provider/Docker 数据。

## 十一、为什么这样拆分

- 任务解析与 runtime packaging 是决定“能否在任务 image 内真正运行”的前置边界，独立后可在
  无 provider、无 Docker E2E 的环境中测试。
- 网络/认证/资源限制具有安全所有权，不能散落到 task parser 或结果收集逻辑中。
- 编排和 evidence 是调用侧工作；它依赖前两项但不拥有 Docker/Agent 语义。三者分开后，后续
  接入 verifier 或远程 sandbox 也不会污染本地 CLI/Server 路径。
