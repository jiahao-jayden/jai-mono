# 需求说明: Agent 运行轨迹观测

日期:2026-08-29

## 问题

JAI 已经长期保存会话消息、分支、压缩、模型尝试、usage 和工具派发，但这些事实分散在 Session journal、Operation journal 与运行时事件中。开发者目前只能从聊天投影或 CLI 流式输出观察执行，不能在一个页面里按 Session 回看 turn、模型请求、工具调用、耗时、usage 和错误，也没有供本机工具稳定读取这些信息的 HTTP 接口。

受影响者是调试 Agent 行为、分析延迟和排查工具失败的本机开发者，以及需要在本机集成 JAI 运行轨迹的工具作者。

## 期望结果

- 本机开发者可以在独立 Browser 页面或 Desktop 内嵌页面打开同一个单 Session 运行轨迹，按时间顺序查看 turn、模型尝试、工具调用、usage、耗时和安全错误信息。
- Browser 与 Desktop 共享同一套轨迹主体、客户端状态 reducer、record identity 消费逻辑和 loading/error/reconnect 交互；Browser host 保留 token bootstrap 与 REST/SSE，Desktop host 通过现有本机 ACP v2 客户端、Electron IPC/push 保留自己的导航与 transport。
- 页面同时展示已完成历史和当前运行进度；刷新或 Runtime Host 重启后，已完成轨迹仍可恢复。
- 长期保存首个与末个输出时间、chunk 数量和类型等流式摘要；不重复保存每个 chunk 的文本，最终文本继续由现有消息事实维护。
- Runtime Host 在 `127.0.0.1` 提供版本化的 preview HTTP 接口：REST 读取快照和历史，SSE 推送实时变化，并提供 OpenAPI 说明。
- 本机接口使用 Runtime Host 在内存中签发的临时 Bearer capability token、严格 Origin/CORS 和 loopback 绑定。默认 token 只能读取元数据；包含 prompt、reasoning、工具参数或输出的 token 必须由本机控制入口显式签发固定 scope，HTTP 请求不能自行扩大权限，返回内容还必须经过白名单投影。

## 影响范围

会改到的模块:

- `@jai/agent` 的 Operation journal 契约与执行事件，用于长期保存 turn、模型流和工具执行的观测摘要。
- `app/server` 的 Runtime Host、Session/Operation 读取投影、loopback HTTP/SSE adapter、认证和 OpenAPI。
- `app/server` 现有本机 ACP v2 连接上的 JAI namespaced read-only trajectory protocol adapter；它只观察 Session，不取得或抢占 Session controller。
- 产品领域明确的共享轨迹界面模块：维护 wire-safe trajectory DTO 的客户端 reducer、record identity 消费逻辑、`TrajectoryView` 与小而稳定的 `TrajectoryDataSource` interface。
- 面向浏览器的单 Session host、REST/SSE data source adapter 与静态资源装配。
- `app/desktop` Main 的现有 `LocalAcpV2Client` 消费、Electron main/preload IPC + push、renderer data source、导航入口和内嵌页面。
- 相关 CLI 或本机控制入口，用于安全地获得并打开带临时访问凭据的页面。

长期保存的数据与维护方:

- 会话消息、分支、压缩与 Session App State 仍由 `@jai/agent` Session journal 维护。
- operation、model attempt、usage、tool dispatch，以及新增的 turn/model stream/tool timing 摘要，由 `@jai/agent` Operation journal 维护。
- Session 标题和项目归属仍由 Desktop catalog 维护；观测投影只读取，不写回。
- 所有长期事实仍只写入 `$JAI_HOME/data.sqlite`，不新增 JSONL、第二套数据库或双写日志。

## 边界

- 第一版只做单 Session 轨迹，不做跨 Session/项目聚合、运营指标、告警或多租户。
- 只绑定 loopback，不监听局域网或公网，不建设用户账号、团队权限或远程部署。
- 不把 OTLP exporter、Grafana、Datadog 或其他第三方观测平台作为第一版交付。
- 不持久化每个流式 chunk 的文本、renderer seq、审批 UI 状态或其他运行中界面状态。
- 不记录原始 HTTP request/response、Authorization header、SSE frame、stack、cause 或未筛选 SDK 错误。
- 不让页面、共享轨迹界面模块、HTTP 或 Electron IPC 投影成为新的事实维护方，也不允许它们写回 journal。
- Desktop 不通过 iframe 嵌入 Browser 页面，不访问 loopback HTTP，也不接触 bearer capability。正确链路固定为：Server read-only trajectory module → 现有本机 ACP v2 连接上的 JAI namespaced read-only protocol adapter → Desktop Main 的 `LocalAcpV2Client` → Electron main/preload IPC + push → Desktop `TrajectoryDataSource`。
- Server 不导入 Electron，不提供或依赖 Electron protocol adapter；trajectory 也不塞入 desktop catalog/config 私有通道。
- 共享轨迹界面模块不导入 SQLite、`@jai/agent` internals、Server internals、Electron 或 Desktop 专属实现；transport、auth、host chrome 和导航留在 Browser/Desktop host。
- DeepSeek Harness 只作为运行轨迹信息架构和交互行为参考，不追求协议或实现兼容。

## 工作量

大。需求同时改变长期保存的执行事实、Runtime Host 的读取 interface、一个新的本机网络安全边界、两种 host transport、共享 React 轨迹模块与 Browser/Desktop 页面，需要拆成可独立验证的工作项，先固定数据和 Server seam，再实现共享界面与两个 host。

## 已确认的现状

- Session journal 已保存 `message`、`app_state`、`compaction` 和 `branch`；Operation journal 已保存 `operation_accepted`、`model_attempted`、`usage_settled`、`tool_dispatched`、`input_queued` 和 `operation_finished`。
- turn 边界、流式 chunk、terminal 输出和多数耗时目前只存在于内存事件，Runtime Host 重启后不能重建。
- Desktop 当前消费 ACP `session/update` 的聊天子集，无法读取完整 Operation journal；现有 Renderer RPC 也没有观测专用读取 interface。
- Desktop 已有 Electron RPC 与 renderer push event 基础设施，可承载独立 trajectory adapter；共享轨迹界面模块与 Browser workspace 当前尚不存在。
- Runtime Host 当前只通过 Unix domain socket / Windows named pipe 上的 ACP v2 JSON-RPC 服务本机客户端；仓库里没有 Agent Session 的 HTTP、SSE 或 WebSocket 服务，也没有用户级认证。
- CLI 与 Desktop 共用同一个 Runtime Host；`$JAI_HOME/data.sqlite` 是唯一长期 journal。
- 现有架构要求长期事实只有一个维护方，projection 单向读取，RPC/UI 边界通过显式白名单 DTO，不能跨进程传递 stack、cause 或未筛选 SDK 错误。

## 参考对象

- DeepSeek Harness 的 `SessionEvent → Trajectory` 模式只借鉴思路：统一使用已保存的 Agent 事实构建历史与实时轨迹，并以相同 record identity 联动时间线和明细。JAI 不采用其 JSONL 持久化、完整 chunk 文本落盘或默认遥测上传策略。
- 固定版本、证据和与 Pi Agent 的对比见[调研笔记](../../research/deepseek-harness-pi-agent-observability.md)。
