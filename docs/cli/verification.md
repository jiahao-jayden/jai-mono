# SDK、CLI、Desktop 与 WorkBuddy 验收

本文件定义 `@jai/coding-agent` 的实现完成条件。所有测试使用同一 public contract，不允许通过内部 `@jai/agent` 类型绕过验收。

## 1. 测试分层

### SDK conformance

使用 fake Host Authorities 和 deterministic fake provider，覆盖：

| 场景 | 必须验证 |
| --- | --- |
| `new` / `resume` / `ephemeral` | resume 不存在返回 Err；ephemeral close 清理；无 open-or-create fallback |
| Prompt admission | `steer`、FIFO `queue`、active drain join、普通 prompt 不 busy |
| Abort/close | abort 保留 admitted input；close 幂等；外部 lease 正确清理 |
| Permission | 五种 mode、Danger Layer、explicit deny、session/project allow、approval timeout/cancel |
| External tools | MCP/Plugin/Connector 与 built-in 使用同一 evaluator；失败 source 隔离 |
| Capability Snapshot | creation 时冻结、排序稳定、collision diagnostic、运行中不能注入 |
| Subagent | 无 SpawnAgent/UpdateTodos、parent cancellation、child cleanup、结果回传 |
| Agent events | canonical Agent event 顺序、normalized assistant events、无 provider raw event |
| Agent State | transcript/Todo/Artifact/App State 单一事实来源；重启恢复一致 |
| Error DTO | Result 与 run failure 使用同一白名单 DTO；JSON round-trip；无 stack/cause |

### Host Adapter contract

Desktop、CLI、WorkBuddy 使用同一组 conformance fixtures，只替换 Authority implementation：

- model authority 只暴露 credentials/transport，不泄露 provider client；
- approval authority 正确处理 allowOnce/alwaysAllow/deny/abort/timeout；
- session authority 正确处理 lock、durable、ephemeral 和 cleanup；
- optional capability source 失败不阻塞其他 source；
- Host 不传 AgentTool、raw Agent 或 prompt/policy callback。

### CLI / WorkBuddy E2E

- `jai --help`、`jai --version` 无模型配置也能运行；
- `jai -p` 支持 argv prompt 和 stdin prompt；
- `text` 输出最终 assistant text；
- `json` 输出一个 JSON-safe result；
- `stream-json` 每行都是可解析 JSON，事件由 `CodingAgentEvent` 投影而来；
- durable `--session-id` 可恢复，`--no-session-persistence` 不留下 session；
- 无 TTY approval 不挂死，返回稳定错误和退出码；
- SIGINT 返回 130；
- WorkBuddy Code、Web、Office、Security 四类 harness 都只调用普通 CLI，不使用 benchmark 专用 flag。

在允许 loopback 的环境，运行 `cd app/cli && bun run test:e2e`。该 test 启动 OpenAI-compatible mock、spawn 实际 CLI process、验证 tool call、workspace 写入和 stream-json result；默认单测不启动端口。

## 2. Public export 与 wire-safety 检查

CI 必须检查：

1. `@jai/coding-agent` root export 包含 `createCodingAgent` 和稳定 DTO，但不包含 `CreateCodingAgentOptions`、raw `@jai/agent` types、provider client、tool factory 或 Desktop types。
2. 每个 public event、state、permission、error DTO 通过 JSON stringify/parse 后保持可用。
3. DTO 深度检查不出现 `Error`、`stack`、`cause`、函数、signal、class instance、provider SDK object 或 Host-private state。
4. TypeScript consumer fixture 只从 `@jai/coding-agent` root import，不能依赖 implementation subpath。

## 3. CLI contract

| 条件 | 结果 |
| --- | --- |
| 正常 Agent 完成 | exit 0 |
| provider/runtime/tool failure | exit 1 |
| CLI usage 或 approval unavailable | exit 2 |
| SIGINT | exit 130 |

`--permission-mode plan` 在当前 milestone 返回 typed unsupported mode；不能 fallback 到 `default` 或通过 prompt 模拟。

## 4. Desktop hard-cut 验收

第一阶段已经完成：Desktop factory 和 Host 的 Agent handle 均来自 `@jai/coding-agent`，SDK 是 Todo/Artifact/session facts 的唯一写入方。下面的组件仍然存在，但只允许承担宿主生命周期、审批注册和 renderer 投影，不得重新获得 Agent 语义：

以下文件和 abstraction 不得继续承担 Agent 语义：

- `app/desktop/electron/agent/factory.ts`
- `app/desktop/electron/agent/host.ts`
- `app/desktop/electron/agent/projector.ts`
- `app/desktop/electron/agent/assistant-projector.ts`
- `app/desktop/electron/agent/artifacts.ts`
- `app/desktop/electron/agent/plugin-directories.ts`
- `DesktopAgentHost`（最终只保留 UI/IPC 投影与宿主生命周期）
- `DesktopAgentSnapshot`、`DesktopTranscriptItem`、Desktop Agent event union

Desktop 的目标边界是只实现 Host Authorities、IPC envelope、UI selectors 和产品 metadata；不创建 generic Agent、不解释 provider raw event、不写 Session App State、不推导 Todo/Artifact、不拥有独立 execution drain。当前代码已满足这一边界的第一阶段版本。

## 5. Hard-cut 顺序

已完成：

1. 发布 `@jai/coding-agent` 的 `createCodingAgent`、public types 和 Host Authority ports。
2. 实现 SDK conformance fixtures 与 fake provider。
3. 将 CLI 从内部 runtime imports 切换到 SDK adapter。
4. 将 Desktop 切换到 SDK adapter 和 `CodingAgentState`。

进入实现阶段：

5. 在允许本地 provider/loopback 的环境跑 CLI subprocess smoke。
6. 在 WorkBuddy 中固定 CLI 版本，依次接入 Code、Web、Office、Security 四类 harness。
7. 运行 typecheck、unit、adapter、E2E、wire-safety 和 WorkBuddy 基线。

完成标准：另一个实现者只阅读本目录三份文档，就能创建一个 Host Adapter；Desktop 和 CLI 对同一个 fake provider、Session、permission 和 Agent event contract 通过共同 conformance 测试。
