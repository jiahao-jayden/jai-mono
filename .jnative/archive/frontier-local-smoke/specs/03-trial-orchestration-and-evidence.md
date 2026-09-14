# Work 3：单 trial 编排与 evidence

状态：⚠️ 已实现；真实 agent E2E 被宿主 disk quota capability 阻断

## 目标

把 task plan 和隔离 environment 组合成一个单 trial 生命周期，容器中调用现有 JAI CLI，采集
CLI 最终 ACP 投影和 workspace evidence，最后写出不声称官方评分的 local smoke result。

## 负责边界

- 生成 trial ID，依次执行 preflight、environment open、CLI prompt、超时收敛、evidence export、
  result projection 与 finally cleanup。
- 在任务工作区运行 CLI，使用用户选定 model、`automate` mode、stream JSON，并等待 final event。
- 把 CLI 的 stop reason、tool calls/errors、cost、duration 和容器退出/总耗时映射到安全结果。
- 导出可获得的 workspace patch/digest 与受限日志引用；明确标识 evidence 不等于 verifier pass。
- 在 `build-cython-ext` 上提供显式 Docker E2E smoke，不引入并发、retry、排行榜或 verifier。

## 对外行为

终端只输出稳定的阶段和结果路径；机器可读 result 仅含计划中规定的白名单字段。任何异常结果都
保留清晰 category，但不输出 stack、cause、API key、完整 provider response 或宿主配置。成功表示
trial 生命周期和证据收集完成，不表示任务正确或 Frontier 通过。

## 测试点

- 生命周期状态机覆盖 setup、agent、timeout、evidence 和 cleanup 分支；cleanup 即使前一步失败也
  执行，且只删本 trial 的资源。
- CLI stream 的 final projection、缺失 final event、非零退出和错误 DTO 投影均有单元测试。
- 显式环境变量启用的 Docker E2E 对 `build-cython-ext` 验证：CLI→Server ACP 真实调用、task 无
  direct egress、gateway 成功通行、result 无 secrets、容器/网络最终不存在。

## 开始前确认

- Work 1 和 Work 2 的完成前检查均已通过。
- Docker daemon 可用；所选模型的 gateway credential 已由用户在 task 外安全配置。
- 本次验收仍以 local smoke evidence 为准，未把官方评分/验证器纳入范围。

## 完成前检查

- 单 task/single-trial 从输入到安全 result 可重复运行，agent 仅经 CLI→Server ACP 执行。
- result 明确包含网络策略、已应用限制、运行分类和 CLI 白名单指标，并且不含敏感信息。
- `build-cython-ext` Docker E2E 在显式开关下完成，且所有 trial-owned Docker 资源已清理。
- 新工具及 `app/cli`、`app/server` 的相关类型检查/测试通过，`git diff --check` 无问题。
