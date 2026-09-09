# Work 1：任务 contract 与 CLI runtime packaging

状态：✅ 已实现并验证 Linux runtime build

## 目标

让 runner 能以固定 Frontier revision 的公开 task directory 为输入，安全解析并校验
`instruction.md` 与 `task.toml`，生成不可变的单-trial 执行计划；同时证明现有 JAI CLI、其
Server ACP 依赖和运行时能够在目标 Linux task image 中执行。

## 负责边界

- 定义公开任务输入的最小 schema：任务名、image、CPU、memory、disk、timeout、network。
- 拒绝缺失、类型不对、负值、未知不可执行限制、`allow_internet=true` 或超出本地 smoke 支持
  边界的任务定义，并给出稳定错误 tag。
- 生成可审计的 task summary 和限制 plan，不将 instruction 原文或任意 TOML 扩散给结果 DTO。
- 定义、构建并验证 Linux 可执行 CLI runtime 的 packaging contract；不得假设 task image 预装
  Node 或 Bun。
- 不负责创建 Docker network、配置 gateway、调用模型或写最终 trial result。

## 对外行为

成功时返回 task plan，包含 image ref、已确认的限制、任务摘要、固定 source revision 和
runtime packaging identity。失败返回 `frontier_smoke.task_invalid`、
`frontier_smoke.constraint_unsupported` 或 `frontier_smoke.runtime_unavailable` 等白名单领域错误。

runtime preflight 必须能报告“目标 image 是否能启动 JAI CLI 并使其与 Server 完成 ACP
initialize”；它不能以宿主 CLI 成功替代容器内成功。

## 测试点

- 合法 `task.toml` 能生成精确的限制 plan；非法值、缺文件、未知字段策略和 internet task 都被
  覆盖。
- 结果/错误投影不包含输入中的非白名单内容、stack 或 cause。
- runtime packaging 纯逻辑与 platform selection 有单元测试；有 Docker 时增加一个最小容器
  preflight，验证实际 CLI/Server 启动。

## 开始前确认

- 本 spec 已在 `todo.md` 中，并且上游固定 revision 与首个任务选择没有变化。
- Docker 实现方案能保持 CLI→Server ACP 作为唯一 agent 执行路径，不会引入第二个 agent adapter。
- Linux runtime packaging 的交付边界已明确；不能仅靠“任务 image 大概率有 Node”的假设继续。

## 完成前检查

- 所有公开 task input 都经 schema 校验，未支持或无法强制的约束会显式失败。
- 已有可重复的容器内 CLI/Server ACP preflight，且不依赖 host 的 `~/.jai`。
- 代码按 core/runtime/adapter/projection 职责分层；可恢复错误使用 Result 与 TaggedError。
- 单元测试和该 Work 相关类型检查通过；没有为旧输入格式添加兼容/fallback。
