# Work 2：隔离 gateway 与 trial environment

状态：✅ 已实现；disk quota preflight 已验证为 fail-closed

## 目标

为每个单 trial 建立可清理、fail-closed 的 Docker 环境：任务容器只能访问内部 provider gateway；
gateway 才能访问一个明确 allowlisted 的模型上游。Agent 既看不到 host `~/.jai`，也拿不到上游
provider key。

## 负责边界

- 创建带 trial ID 的 internal-only network 与 gateway egress network，及严格的 ownership registry。
- 把任务容器仅加入 internal-only network；禁止 host 配置、home、Docker socket 和 API key bind
  mount / env 注入。
- gateway 持有上游 key，并仅代理选定 provider/model 所需的 URL、方法和流式响应；任务侧只得到
  gateway endpoint 和无上游 key 的短期 Server 配置。
- 映射并验证 `task.toml` 的 CPU、内存、时限、网络及磁盘限制；Docker backend 无法可靠执行任一
  必要限制时，setup 失败。
- 管理 gateway health/readiness 和逆序 cleanup；不负责 task 指令、CLI prompt 和最终 evidence。

## 对外行为

输入是 Work 1 的不可变 task plan、已在用户本机安全解析的模型选择以及 trial ID。成功返回可供
编排器使用的隔离 trial environment；失败为 `frontier_smoke.docker_unavailable`、
`frontier_smoke.isolation_unenforceable`、`frontier_smoke.gateway_unhealthy` 或
`frontier_smoke.gateway_configuration_invalid` 等安全领域错误。

任务容器的 JAI Server profile 只能指向内部 gateway。gateway 的上游 key 不进入 task container
filesystem、环境变量、CLI 参数、结果或日志 DTO。

## 测试点

- Docker command/options projection 和 trial-owned cleanup registry 有单元测试。
- 认证投影测试断言 task-side config 不含上游 credential；日志/错误 projection 不泄露它。
- 有 Docker 时验证 task 无法 direct egress、仅能解析/reach gateway、gateway 只允许目标上游。
- 对不支持 disk quota 或 network isolation 的 Docker backend，验证在启动 task 前 fail closed。

## 开始前确认

- Work 1 已证明可在 task image 内启动现有 CLI 与 Server ACP。
- gateway 的 provider protocol/streaming 需求已按所选模型确认，且上游 key 可以只置于 gateway。
- Docker daemon 可用，并能查询本机用于限制强制的 storage/network capability。

## 完成前检查

- 任务容器没有 direct internet、host `~/.jai`、Docker socket 或上游 key 的可见路径。
- 所有 Docker 资源都带精确 trial ID，异常、中断和超时均走逆序 cleanup。
- 资源限制要么实际应用并被记录，要么 setup 失败；没有“最佳努力”静默降级。
- gateway readiness、认证和错误 DTO 都经过安全投影；相关单元/隔离测试与类型检查通过。
