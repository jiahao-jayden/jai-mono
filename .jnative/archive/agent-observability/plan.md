# 计划: Agent 运行轨迹观测

来源:[需求说明](./intent.md) · 日期:2026-08-29 · 状态:✅ 已确认 · 可执行 · 确认日期:2026-08-29

已确认文件:`intent.md`、`plan.md`、`todo.md`、`CONTEXT.md` 与 `specs/` 下全部 7 份工作项。
开始条件已满足；按依赖顺序连续实施，只有完成前检查失败、计划需要改动或用户暂停时才停止。

## 背景

JAI 已把 Session message、branch、compaction、Operation admission、model attempt、usage、tool dispatch 和 terminal outcome 写入同一个 SQLite journal，但 turn、模型流首末输出、chunk 摘要、工具完成时间等仍只存在于内存事件。Runtime Host 目前只提供本机 socket/pipe 上的 ACP v2；Desktop 和 CLI 只能看到聊天子集，也没有供本机工具读取完整轨迹的 HTTP interface。

第一版现在明确同时交付独立 Browser 页面与 Desktop 内嵌页面。两边展示同一单 Session 轨迹，不能各自实现 reducer、record identity 和交互状态；但 Desktop 也不能为复用 UI 而绕路请求 localhost HTTP 或接触 Browser bearer token。

## 方案

1. 在 `@jai/agent` Operation journal 增加 turn、model stream、tool timing 的结构化完成事实。摘要关联既有 operation/attempt/tool identity，只保存开始/结束或首/末输出时间、结果状态、chunk 总数及白名单类型计数，不保存 chunk 文本。现有 SQLite JSON record 表直接承载新 record type，不新增表、迁移、兼容层或第二套 store。
2. 在 Server 建立一个小而稳定的只读观测 interface。调用方按 Session 与已鉴权 scope 打开 trajectory feed，得到带高水位 cursor 的 snapshot，并从 cursor 继续订阅；模块内部隐藏 Session journal、Operation journal、运行中事件、Desktop catalog 的 join，以及排序、record identity、断线恢复和安全 DTO 投影。Browser HTTP 与本机 ACP v2 上的 JAI namespaced read-only trajectory protocol 都只是这个 module 的 Server-side adapter。
3. Runtime Host 额外绑定 `127.0.0.1` 随机端口，提供 `/v1` preview REST、SSE 和 OpenAPI。Host 在内存中签发绑定 Session、固定 scope、短生命周期的随机 Bearer capability；默认只有 metadata scope，内容 scope 只能由本机控制入口授予。严格拒绝不匹配 Origin/CORS，token 不落盘、不进 query。
4. 新建一个产品领域明确的**共享轨迹界面模块**，暂定包名 `@jai/trajectory-ui`（实施时若仓库命名核对要求不同，可在不改变领域 owner 的前提下确定最终名称；目录不得叫 `common`、`shared` 或 `utils`）。它拥有 wire-safe trajectory DTO 的客户端状态 reducer、record identity 消费逻辑、共享 loading/error/reconnect 状态与可复用 `TrajectoryView`，只暴露小而稳定的 `TrajectoryDataSource` interface。它不导入 SQLite、`@jai/agent` internals、Server internals 或 Electron；只有确实因 Browser/Desktop 而变化的 host 能力才通过窄语义 interface/slots 注入，不为假想变化预建抽象。
5. Browser host 使用 REST + authenticated fetch-based SSE 实现 `TrajectoryDataSource`，负责 token fragment bootstrap、CSP/no-referrer、静态资源、Browser navigation 与真实浏览器验证。
6. Desktop 链路固定为：Server read-only trajectory module → Server 现有本机 ACP v2 连接上的 JAI namespaced read-only trajectory protocol adapter → Desktop Main 现有 `LocalAcpV2Client` → Electron main/preload IPC + push → Desktop `TrajectoryDataSource` → 共享 React view。ACP observer 只读观察，不取得或抢占 Session controller，也不能阻塞/影响运行中的 Agent。Server 不导入 Electron；Desktop renderer 不请求 loopback HTTP、不接触 bearer。Desktop host 负责 chrome、Session 导航与真实 Electron 验证。
7. 最后装配产品启动流并做 E2E/security。Browser 本机入口确保 Host 可用并签发 scoped capability；Desktop 入口从现有 Session 导航打开内嵌轨迹。使用最终 Runtime Host composition、真实 Browser 和真实 Electron renderer 验证重启恢复、snapshot/stream 衔接、ACP observation、IPC push、REST/SSE、scope 不可提权、Origin/CORS、资源关闭和默认脱敏。

可恢复失败使用 `better-result` 的 `Result<T, E>`，领域错误使用 `TaggedError`。所有 HTTP、SSE、Electron IPC 与 renderer push 只发送显式白名单 DTO；UI、transport 和 host chrome 都不是事实 owner。

## 外部产品或规范的约定

- [DeepSeek Harness 固定版本调研](../../research/deepseek-harness-pi-agent-observability.md)只作为信息架构与交互参考：借鉴 canonical facts 投影 Trajectory、历史与实时使用相同 identity；不兼容其协议，不采用 JSONL/Zstd、逐 chunk 文本持久化、OTLP 或默认上传。
- OpenAPI 采用 [OpenAPI Specification 3.1.1](https://spec.openapis.org/oas/v3.1.1.html) 描述 `/v1` preview、安全 scheme、错误 DTO 和 SSE endpoint；不承诺旧 preview 兼容。
- SSE framing、`id`/重连语义参考 [WHATWG Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)。Browser 因 Bearer header 使用 fetch-based 流解析，不使用 query token。
- Bearer header 采用 [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html) 的形式，但这里只是 loopback capability，不建设 OAuth。
- Origin/CORS 参考 [WHATWG Fetch](https://fetch.spec.whatwg.org/)；产品约束更严格，只允许明确的 loopback Browser origin。Desktop IPC 不复用这一网络认证模型。

## 需要先想清的事

| 维度 | 结论 | 依据 |
|---|---|---|
| 长期保存的数据与兼容 | 已确认：timing summary 由 `@jai/agent` Operation journal 维护，只写现有 SQLite；不迁移、不 fallback | 需求说明和项目 owner 规则；现有 JSON record 表可承载新 record type |
| 外部产品或规范的约定 | 已确认：DeepSeek 只借鉴信息架构；Browser 使用 `/v1` preview REST/SSE/OpenAPI；Desktop 使用现有本机 ACP v2 上的 JAI namespaced 只读协议，再经 IPC/push | 用户明确固定依赖链；两边复用 Server read-only module 与 wire DTO |
| 用户和调用方看到的行为 | 已确认：Browser 与 Desktop 都提供单 Session trajectory，主体、状态和交互一致，host chrome/navigation 各自保留 | 用户明确改变第一版范围与共享/差异边界 |
| 权限与安全 | 已确认：Browser 使用 scoped Bearer + Origin/CORS；Desktop 走 IPC、不接触 bearer；两边只接收白名单 DTO | 不把 Browser 网络 capability 泄漏到受信任 Electron renderer path |
| 运行环境和依赖 | 已确认：新建共享 React 轨迹包和 Browser workspace；Desktop 复用现有 React/Vite/UI 基础 | 两个新 package 当前不存在；Desktop 已有 React 19、Vite 7、Base UI、TanStack Query 和 Electron RPC |
| 同时操作和失败重试 | 无需用户决定：Server feed 负责 snapshot/cursor；ACP observer 不取得 controller、不得影响 Agent；共享 reducer 负责 identity 去重和 reconnect state | 只读 observer 与执行 controller 分离，transport 只交付同一 DTO |

## 已确认的关键选择

- 使用者是本机开发者；第一版只观察单 Session。
- Browser 独立页面与 Desktop 内嵌页面同时交付，共享轨迹主体、状态 reducer、record identity 和交互。
- Server 一个 read-only trajectory interface 隐藏 join 与 snapshot+stream cursor；Browser HTTP 与 JAI namespaced ACP trajectory protocol 是两个 Server-side adapter。
- Browser 使用 `127.0.0.1` REST/SSE/OpenAPI、scoped Bearer capability 和严格 Origin/CORS。
- Desktop Main 使用现有 `LocalAcpV2Client` 消费 JAI namespaced read-only trajectory protocol，再通过 Electron IPC + push 给 renderer；observer 不取得 Session controller。
- Server 不导入 Electron；Desktop 不访问 localhost HTTP、不接触 bearer capability。
- 共享轨迹界面模块只暴露 `TrajectoryDataSource`，不依赖 SQLite、Agent/Server internals、Electron 或 Desktop 专属实现。
- timing summary 属于 `@jai/agent` Operation journal；只写 `$JAI_HOME/data.sqlite`，不持久化 chunk 文本。
- 不做 OTLP、跨 Session/项目聚合、告警、远程访问、多租户或运营指标。

## 没选的路

- **iframe 嵌入 Browser trajectory**：复用了页面外壳而不是产品模块，会把 token、CSP、导航和尺寸问题带进 Desktop，也无法自然复用 Desktop 主题与交互。
- **Desktop 访问 localhost HTTP**：让受信任 Electron path 绕路穿过 Browser auth/CORS，制造 bearer 分发、端口发现和额外失败面。
- **Server 提供或依赖 Electron protocol adapter**：反转 Server→Host 依赖方向，把 Electron 类型和生命周期带入 Runtime Host；正确做法是 Server 暴露 ACP namespaced 只读协议，由 Desktop Main 适配 Electron。
- **把 trajectory 塞入 desktop catalog/config 私有通道**：这些通道各自拥有 catalog/config 事实与控制语义，不应成为新的泛化隧道；trajectory 属于 ACP Runtime Host 的只读观察协议。
- **UI 直接读取 SQLite 或 Agent/Server internal objects**：让 renderer 成为事实解释者，破坏白名单 DTO、owner 和进程隔离。
- **把 transport、auth、host navigation/chrome 与 UI 塞进一个大 SDK**：接口会同时暴露 REST、SSE、IPC、Bearer、Electron 和 React 细节，形成浅模块并迫使两个 host 学会不相关能力。
- **Browser 与 Desktop 各写一套 trajectory reducer/view**：record identity、重连和内容权限会漂移，修复无法保持 locality。
- **把共享包叫 `common`、`shared` 或 `utils`**：隐藏领域 owner，违反目录规则；它应以 trajectory 产品领域命名。
- **为每个 slot、mapper 或 transport step 建 interface/factory**：只有 Browser/Desktop 确实变化的 data source 和 host slots 是真实 seam，其余保持模块内部实现。
- **新增 observability JSONL、专用 SQLite、双写或逐 chunk 文本落盘**：制造第二事实 owner、重复敏感内容和一致性问题。
- **原生 `EventSource` + query token**：不能设置 Authorization header，query token 容易进入 history/log/referrer。
- **绑定 LAN/public、账号、多租户、OTLP、聚合或告警**：均超出本机单 Session 第一版。

## 风险

- snapshot 与 live subscribe 的竞态仍是最大数据风险；必须由 Server read-only module 从同一事实顺序生成高水位 cursor，不能交给 transport/UI 补洞。
- wire-safe DTO 若在 HTTP、ACP 或 IPC 间分叉，会让共享 reducer 失去意义；各 adapter 必须输出同一契约并做 contract tests。
- `TrajectoryDataSource` 若泄漏 auth、cursor transport 或 Electron channel 细节，会把共享轨迹界面模块变成大 SDK；interface 只表达界面需要的 snapshot/subscribe/reconnect/close 语义。
- 共享 React module 若直接使用 Desktop alias、icon context 或 CSS implementation，Browser 会被迫拉入 Desktop；确实变化的 host action/theme/icon 通过窄语义 slot 接入。
- 反方向若预防性抽象所有视觉 primitive，会复制 Desktop design system；先复用成熟依赖，只对 Browser/Desktop 真正不同的能力设 seam。
- ACP trajectory observer 必须与 Session controller 完全分离；若读取会取得 controller、触发恢复或将背压传给 Runtime Session，就会影响正在执行的 Agent。
- Desktop Main/IPC push 必须处理 renderer 重载、窗口关闭、Session 切换、慢 consumer 与 cursor 过期，且不能把背压传回 ACP/Agent。
- Browser token fragment 仍可能被扩展或截图看到；必须立即清除、仅内存、短时、Session/scope 绑定，并禁止第三方 runtime request。
- Runtime Host 同时管理 SQLite、ACP、HTTP 和 trajectory subscriptions；任一资源失败要整体回滚，close 要关闭 SSE 与 ACP observers。Electron IPC subscription 生命周期由 Desktop Main 管理。
- 新共享轨迹包与 Browser workspace 尚不存在，不能伪造 package scripts；实施时必须创建真实 scripts 后回填并执行。
- Desktop 当前只有 `typecheck` script、没有 test script；计划只列现有命令。实施 Desktop 工作时必须按项目规则运行相关测试，并先把采用的真实 test script 写入 package manifest 后回填。

## 必须遵守的项目规则

- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。”（`AGENTS.md`，「错误处理规则」）
- “领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。”（`AGENTS.md`，「错误处理规则」）
- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”（`AGENTS.md`，「错误处理规则」）
- “一类 durable fact 只能有一个 owner：……运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。”（`AGENTS.md`，「事实归属」）
- “Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`）。不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。”（`AGENTS.md`，「事实归属」）
- “Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。”（`AGENTS.md`，「事实归属」）
- “目录首先按领域事实或角色命名，而非按泛化技术命名。新目录不得命名为 `data`、`common`、`shared`、`helpers`、`utils`、`services`、`misc`。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “`main.ts`、`runtime.ts`、composition root 只负责装配与生命周期；`index.ts` 只定义模块对外 interface 和 re-export。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “依赖方向固定：……adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “测试目录镜像源码领域目录；测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。”（`AGENTS.md`，「目录导航与拆分」）
- “优先用成熟的、有人维护的库。没有明确理由别自己重写。”以及“先翻项目里已有的依赖能做什么，再考虑加新包或自己写。”（`AGENTS.md`，「编码规则」）
- “不要仅为了‘看起来模块化’提取两三行命名函数。”（`AGENTS.md`，「函数抽取规则」）
- “`app/desktop` 的产品界面优先复用 `src/components/ui/*`；已有等价组件时，不直接书写原生交互元素或重复实现 hover、focus、loading、disabled 等状态。”（`AGENTS.md`，「组件规则」）
- “Desktop 业务组件通过 `@/lib/icon-context` 的 `useIcon` / `useIcons` 使用图标……”（`AGENTS.md`，「组件规则」）
- “修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。”（`AGENTS.md`，「组件规则」）
- “`app/desktop` 的 JSX 属性，尤其 `className`，禁止模板字符串、字符串拼接和 JSX 内的条件表达式来组合值。组合 Tailwind class 必须使用 `@/lib/utils` 的 `cn`……”（`AGENTS.md`，「组件规则」）
- codebase-design 要求删除测试、interface 即测试 surface、一个 adapter 只是 hypothetical seam；这里 `TrajectoryDataSource` 有 Browser 与 Desktop 两个真实 adapter，其他内部步骤不额外造 seam。（`.agents/skills/codebase-design/SKILL.md`）

## 要运行的检查

| workspace | 当前真实命令 |
|---|---|
| `@jai/agent` | `cd packages/agent && bun run typecheck`；`cd packages/agent && bun test` |
| `@jai/coding-agent` | `cd packages/coding-agent && bun run typecheck`；`cd packages/coding-agent && bun test`；`cd packages/coding-agent && bun run test:consumer` |
| `@jai/server` | `cd app/server && bun run typecheck`；`cd app/server && bun test`；`cd app/server && bun run build` |
| `@jayden/jai-cli` | `cd app/cli && bun run typecheck`；`cd app/cli && bun test`；`cd app/cli && bun run build` |
| `@jayden/jai-desktop` | `cd app/desktop && bun run typecheck`；`cd app/desktop && bun test`；`cd app/desktop && bun run build`。 |
| `@jai/trajectory-ui` | `cd packages/trajectory-ui && bun run typecheck`；`cd packages/trajectory-ui && bun test`；`cd packages/trajectory-ui && bun run build`。 |
| `@jai/trajectory-browser` | `cd app/trajectory-browser && bun run typecheck`；`cd app/trajectory-browser && bun test`；`cd app/trajectory-browser && bun run build`；`cd app/trajectory-browser && bun run test:browser`。 |
| 仓库静态检查 | `bun run lint` |

## 为什么这样拆分

01 先固定 durable timing，02 再把历史/live/catalog join 和 cursor 收进 Server 深模块。03 独立验证 Browser 网络安全 adapter；04 在 wire-safe DTO 稳定后建立共享轨迹界面模块。05 只完成 Browser host/data source。06 从 ACP namespaced 只读协议一直交付到 Desktop 内嵌页，确保依赖方向和 observer/controller 隔离可独立验证。07 只做 composition、入口和跨 host E2E/security。没有把 DTO mapper、slot、token helper、ACP method 或 IPC channel 等 shallow pass-through 单独拆项。
