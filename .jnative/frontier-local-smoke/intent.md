# Frontier local smoke runner：意图

状态：已实现；真实 agent trial 等待可强制磁盘配额的 Docker backend  
日期：2026-09-03

## 背景

JAI 的 CLI 已经通过 ACP 调用本地 Server Runtime Host。因此，验证 Coding Agent 在
`frontier-harness-eval` 任务中的表现，不需要另写一套 ACP client 或 Server adapter。

上游仓库固定在 `0c402ae23724e2d937df0c7038b82203a829a385` 时，只公开了任务说明和
`task.toml` 约束；没有公开 runner、初始/金标准 checkpoint 或 verifier。这意味着本次
只能构建“读取公开任务定义、执行一次隔离 trial、保存可审计证据”的本地 smoke runner，
不能声称产出 Frontier 官方分数。

## 要解决的问题

当前可以人工把 JAI CLI 指向一个目录执行，但不能可靠地做到以下几点：

- 根据公开 `task.toml` 建立 CPU、内存、磁盘、时限和网络边界；
- 让 Agent 只能访问内部模型网关，而不能直接访问互联网或宿主的 `~/.jai`；
- 把 CLI 的最终 ACP 结果、容器结果、工作区 diff 和资源/时间限制汇成一个安全、可复查的
  trial 结果；
- 在 Docker、任务镜像或可执行 runtime 不满足前置条件时明确失败，而不是悄悄放宽隔离。

## 目标结果

新增一个以 Frontier 为领域命名的本地工具。它接受一个任务目录和模型选择，针对一个任务
运行一次 trial：

1. 校验公开任务定义，并生成一个只包含该次 trial 所需配置的临时环境；
2. 用 Frontier 声明的资源限制启动任务环境；
3. 在任务环境中使用现有 `jai` CLI，CLI 继续经由 Server ACP 执行 Coding Agent；
4. 任务环境只连到内部 provider gateway；gateway 才能以显式 allowlist 访问模型上游；
5. 写出安全的 JSON 结果和可选的 patch/log 引用，清理临时容器、网络和认证材料；
6. 首个真实 smoke 使用 `build-cython-ext` 任务，作为包装和隔离能力的端到端证明。

## 不在范围内

- 不实现或伪造 Frontier 官方 verifier、官方 pass rate、reward、checkpoint 对比。
- 不开发远程 sandbox/controller；这与 `.jnative/remote-runtime-sandbox/` 是不同的未确认
  工作，仍由其自身计划约束。
- 不改变 Server、Coding Agent 或 CLI 的 agent 语义；runner 只编排已有 CLI。
- 不支持并行调度、重试、任务矩阵、排行榜、长跑管理或跨 trial 的缓存。
- 不把宿主 `~/.jai` 整目录挂载给任务容器，也不把上游 API key 交给任务容器内的 Agent。

## 已作出的选择

- 评估级别：本地 task-definition-compatible smoke，而非官方评分。
- 网络：任务容器仅可连接内部 provider gateway；gateway 单独拥有上游 egress。
- 运行面：CLI 是 Server ACP client，复用它而不是新建 Server ACP benchmark adapter。
- 首个任务：`build-cython-ext`；Docker preflight 通过后才允许真实试跑。

## 成功标准

- 一个 trial 从任务目录到结果工件可重复运行，且所有任务执行都走现有 CLI → Server ACP 路径。
- 容器无法直连公网、无法读取宿主配置或上游凭据；仅 gateway 有上游访问能力。
- `task.toml` 中不能可靠执行的约束会让 trial 在启动前失败，并在结果中标记原因。
- 结果能区分 setup、agent、超时、Docker/隔离和输出收集失败，且不泄露 stack、cause、token
  或 API key。
- 有纯解析/投影测试、隔离边界测试，以及一个受环境变量显式开启的 Docker E2E smoke。
