# 03: Loopback REST、SSE 与 OpenAPI

要先完成:02 · 状态:✅

## 交付什么

持有 Runtime Host 为指定 Session 和固定 scope 签发的临时 capability 的本机调用方，可以通过 `127.0.0.1` 上的 `/v1` preview REST 获取单 Session trajectory snapshot，通过 SSE 从 cursor 继续观察变化，并从 OpenAPI 获取同一份协议说明。无 token、错误/过期 token、错误 Origin 或试图扩大 scope 的请求不会泄露内容。

## 范围

做:
- 为 Runtime Host 增加仅绑定 `127.0.0.1`、使用随机可用端口的 HTTP listener，并纳入统一 open/rollback/close 生命周期；
- 每次 Host 启动建立进程内 capability issuer，签发高熵随机、短生命周期、绑定 Session 与固定 scope 的 Bearer token；所有 `/v1` REST、SSE 与 OpenAPI 请求统一鉴权；
- REST adapter 只调用 read-only trajectory interface，提供单 Session snapshot、cursor 与明确的错误/status 映射；
- SSE adapter 使用标准 event framing 和 cursor/id，处理断开、重连、heartbeat、cursor 过期、慢客户端上限和 Host shutdown；
- 严格校验 Origin：允许 Host 明确发布的 loopback origin，拒绝未知/null/file origin，不返回 wildcard CORS；正确处理允许的 preflight；
- 内容 scope 采用固定 allowlist；默认 capability 为 metadata-only，HTTP 请求只能缩小、不能扩大 token grant，未知 scope 或越权字段请求失败；
- 发布与实现同步的 OpenAPI 3.1.1，描述 `/v1` preview、Bearer security scheme、scope、snapshot/cursor、SSE endpoint 和白名单错误 DTO；
- 确保 token、Authorization、原始请求/响应、SSE frame、stack/cause 均不进入日志、DTO 或 durable state。

不做:
- 不绑定 localhost hostname、IPv6 wildcard、LAN 或公网地址；
- 不实现账号、OAuth flow、refresh token、团队权限、多租户、远程部署或 TLS termination；
- 不在 HTTP adapter 重做 trajectory join、cursor 或脱敏；
- 不让 Desktop renderer 访问本接口，不向 Desktop 分发 bearer capability，也不把 IPC 转发成 localhost HTTP；
- 不提供 journal 写入、prompt、cancel、approval 或配置修改 endpoint；
- 不实现 Browser/Desktop 页面或共享 React 轨迹界面模块。

## 需要遵守的整体选择

- HTTP 是 read-only trajectory interface 的 adapter，不是事实 owner（见 [plan「方案」](../plan.md#方案)）。
- `/v1` 是 preview；REST + SSE + OpenAPI 同步交付，不建立旧版本兼容层（见 [plan「外部产品或规范的约定」](../plan.md#外部产品或规范的约定)）。
- 安全基线固定为 `127.0.0.1`、进程内 scoped Bearer capability、严格 Origin/CORS、metadata 默认与白名单 scope（见 [plan「已确认的关键选择」](../plan.md#已确认的关键选择)）。
- 本接口只服务 Browser 与本机 HTTP 调用方；Desktop 经本机 ACP v2 上的 JAI namespaced read-only trajectory protocol 消费同一 Server module（见 [plan「没选的路」](../plan.md#没选的路)）。

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。HTTP 地址、端口、capability token/grant/expiry、连接、SSE cursor/heartbeat 与 CORS 状态均属于本次 Runtime Host 进程，不写入 SQLite、配置文件或其他 durable store。adapter 只读取 spec 02 的白名单 trajectory DTO。

## 必须遵守的项目规则

- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。”（`AGENTS.md`，「错误处理规则」）
- “领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。”（`AGENTS.md`，「错误处理规则」）
- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”（`AGENTS.md`，「错误处理规则」）
- “Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal。”（`AGENTS.md`，「事实归属」）
- “adapter 依赖 contract 但不携带宿主业务规则。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “`main.ts`、`runtime.ts`、composition root 只负责装配与生命周期；……它们不得承载领域规则、SQL、UI 投影或协议实现。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。”（`AGENTS.md`，「编码规则」）

## 风险

- DNS rebinding 与恶意网页能访问 loopback；仅 loopback 监听不等于安全，必须在返回任何 Session 信息前同时验证 Bearer 与 Origin。
- token 比较、错误响应或日志若泄露 token 会暴露其绑定 Session 和 scope；capability 必须短时有效，测试必须检查 stdout/stderr 和响应。
- 原生 EventSource 不能加 Authorization；协议不能为了便利接受 query token。
- SSE 慢消费者可能无限占用内存或拖慢 Agent；adapter 必须有有界队列和明确断开/重取 snapshot 语义。
- HTTP listener 启动失败时，ACP、数据库或其他资源可能已打开；composition root 必须整体回滚。
- OpenAPI 与实现漂移会误导本机工具作者；schema/contract test 必须从公开 wire behavior 验证，而非只做文档快照。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] `app/server/test/trajectory/http.test.ts` 覆盖 `127.0.0.1` 绑定、短期进程内 capability 与 Host 重启失效；没有新增 durable state；
- [x] 无/错 Bearer、未知 Origin、metadata 默认和 scope 提权拒绝均在返回 trajectory 前由 HTTP contract tests 验证；
- [x] snapshot cursor、SSE 续接、过期 cursor、慢消费者、断开、shutdown 和 15 秒 idle heartbeat 均有覆盖；
- [x] OpenAPI、Bearer security scheme、scope、错误 DTO 与 SSE endpoint 由同一 HTTP contract tests 验证；
- [x] HTTP adapter 仅依赖 `TrajectoryFeed` 读取接口；其 source graph 不读取 SQLite、Session、Operation 或 Catalog internals；
- [x] `cd app/server && bun run typecheck`；
- [x] 使用 Bun 1.4.0 运行 `cd app/server && bun test`：124 pass、0 fail；
- [x] 使用 Bun 1.4.0 运行 `cd app/server && bun run build`，同时完成 Browser 资产 staging；

## 决策记录
- Browser launch URL 只携带一次性 nonce；页面用 nonce 换取内存 Bearer 后立即清除 fragment。已删除旧的 bearer-fragment 兼容分支，避免 capability 落入 URL。
- HTTP 改用 Node `http` 而非 Bun-specific listener，使 Electron 打包后的 Node Runtime Host 可运行；SSE socket timeout 固定为 30 秒，heartbeat 不因 stream 的 `desiredSize` 被错误关闭。

## 遗留问题
无。

## 交接说明
Loopback adapter 已稳定为统一 wire DTO 的 Browser transport。后续 UI/Browser 工作只消费 REST/SSE，不得引入 SQLite 读取、query bearer 或 Desktop IPC。
