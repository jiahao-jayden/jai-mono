# 02: 单 Session 只读轨迹 interface

要先完成:01 · 状态:✅

## 交付什么

Server 的 Browser HTTP adapter 与本机 ACP v2 上的 JAI namespaced read-only trajectory protocol adapter，可以通过同一个小而稳定的只读 interface，使用已经验证且绑定固定 scope 的访问上下文打开指定 Session 的 trajectory feed：先获得同一时点的安全 snapshot 和 cursor，再从该 cursor 连续接收变化。调用方不需要了解 Session/Operation/Catalog 的 join、运行中事件来源、排序、重连去重或内容脱敏规则。

## 范围

做:
- 建立一个 Server-owned read-only trajectory module，其 interface 只暴露按 Session 与已授予 scope 的访问上下文获取 snapshot、从 cursor 观察变化和关闭订阅所需的最小能力；
- 在 module 内 join Session entries、Operation records、每 Operation 冻结的 model configuration、Desktop Session title/project metadata 以及当前 Host 的 disposable live state；
- 生成稳定 record identity 和父子关系，使 turn、model attempt、stream summary、usage、tool dispatch/result/timing、operation outcome 与安全错误能按时间排序并关联；
- snapshot 返回原子高水位 cursor；stream 从该 cursor 之后开始，处理 snapshot/subscribe 竞态、重复、cursor 过期、慢消费者和关闭；
- 默认 projection 仅含 metadata；访问上下文中的固定 scope 分开控制 prompt/final text、reasoning、tool input、tool output，并逐字段构造白名单 DTO；module 不接受调用方自报、未经授权的 scope 字符串；
- live chunk 可在显式内容 scope 下临时投影，但不成为 durable fact；断线后用最终 message 与 durable timing summary 收敛；
- 固定一套 wire-safe trajectory DTO，供 Browser HTTP/SSE 与 JAI namespaced ACP adapter 原样投影，Desktop 后续只沿 ACP→IPC 转发该 DTO；
- 通过 interface contract tests 同时证明历史、live、重启、并发 append 和权限行为，两种协议 adapter 都不参与这些领域测试。

不做:
- 不提供写 journal、prompt、cancel、approval 或配置修改能力；
- 不让 HTTP handler、SSE serializer、ACP adapter、Electron RPC/push 或任何 UI 直接读 persistence/catalog/runtime internals；
- 不新增 generic repository/interface、每种 source 一个 shallow adapter 或纯 pass-through mapper module；
- 不定义 HTTP status、CORS、Bearer、OpenAPI、ACP method、Electron channel 命名或页面布局；
- 不取得或抢占 Session controller，不通过 observer 触发 prompt/resume/recovery，不导入 Electron。

## 需要遵守的整体选择

- 观测 module 是深模块：小 interface 隐藏 join、identity、snapshot+stream cursor 和白名单 projection（见 [plan「方案」](../plan.md#方案)）。
- projection 单向读取，UI/HTTP/ACP/Electron IPC 不是事实 owner；live 状态可丢，durable snapshot 必须可恢复（见 [plan「已确认的关键选择」](../plan.md#已确认的关键选择)）。
- 默认 metadata-only；内容必须来自已授予 scope，调用方不能提权，scope 也不得绕过字段白名单（见 [plan「风险」](../plan.md#风险)）。

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无新增 durable fact。本项只读取：
- `@jai/agent` Session journal 的 message/branch/compaction/App State；
- `@jai/agent` Operation journal 的 operation/model/usage/tool/timing facts；
- Desktop catalog 的 title/project metadata。

cursor、订阅、live chunk、连接背压和 projected DTO 均为可丢弃读取状态，不写回 SQLite。

## 必须遵守的项目规则

- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”（`AGENTS.md`，「错误处理规则」）
- “Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。”（`AGENTS.md`，「事实归属」）
- “每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；……projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “`main.ts`、`runtime.ts`、composition root 只负责装配与生命周期；`index.ts` 只定义模块对外 interface 和 re-export。它们不得承载领域规则、SQL、UI 投影或协议实现。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “目录首先按领域事实或角色命名，而非按泛化技术命名。新目录不得命名为 `data`、`common`、`shared`、`helpers`、`utils`、`services`、`misc`。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “The interface is the test surface. Callers and tests cross the same seam.”（`.agents/skills/codebase-design/SKILL.md`，「Principles」）
- “The deletion test. Imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.”（`.agents/skills/codebase-design/SKILL.md`，「Principles」）

## 风险

- snapshot/stream race 是本项核心风险；订阅前后 append 都必须恰好出现一次或按 identity 可安全去重。
- Session 与 Operation 当前共享 durable sequence，但不同读取 projection 可能丢失 sequence；module 必须从事实 owner 取得可证明的顺序，而不是按 ISO timestamp 猜总序。
- live chunk 不可 replay；cursor 过期必须显式告知调用方重取 snapshot，不能声称补齐了缺失内容。
- Desktop catalog 缺少对应记录时仍要给出 Agent trajectory；metadata join 失败语义不能让 title/project 变成 Session 存在性的 owner。
- 内容 scope 组合容易遗漏字段；访问上下文必须由 adapter 在鉴权后构造，DTO 必须按 allowlist 生成，不能相信请求自报 scope，也不能先序列化内部对象再删除敏感字段。
- HTTP 与 ACP adapter 若各自改写 DTO，会让共享轨迹界面模块出现 transport 分支；本项 contract 必须让两条链路消费同一 DTO。
- 只读 feed 如果复用取得 controller 的 RuntimeSession open path，会与 Desktop/CLI 当前 controller 冲突并可能影响正在执行的 Agent；observer seam 必须独立。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] interface contract tests 证明调用方只需 Session、scope 与 cursor，不接触 journal/catalog/runtime implementation；
- [x] 并发测试覆盖 snapshot 生成前、生成中、生成后 append，证明不漏 durable record 且重复可由稳定 identity 去除；
- [x] 历史与 live 对同一 turn/model/tool 使用同一 record identity 和排序规则；
- [x] wire-safe DTO contract 不含 HTTP、ACP、IPC 或 host-specific shape，可由后续两种 adapter 原样投影；
- [x] 默认 snapshot/stream 不含 prompt、reasoning、tool args/output、stack、cause 或 SDK error object；
- [x] 每个已授予 content scope 只增加约定字段；调用方无法通过输入额外 scope 提权，未知 scope 返回 TaggedError/Result 失败；
- [x] Host 重启测试恢复 durable trajectory；live cursor 过期明确要求新 snapshot；
- [x] 慢订阅者、listener throw 与 close 不阻塞 Agent execution，不泄漏订阅资源；
- [x] read-only observer contract 不取得/抢占 Session controller，不触发恢复或执行生命周期；
- [x] `cd app/server && bun run typecheck`
- [x] 兼容 SQLite 的隔离 Bun 1.4 运行 `bun test`（107 pass；本机 Bun 1.3.14 不提供 `node:sqlite`）
- [x] `cd packages/agent && bun run typecheck`
- [x] `cd packages/agent && bun test`（231 pass）

## 决策记录
- 读取层直接投影既有 `session_fact_sequences` 的 total order；`ProductSessionDurableState.journalFacts` 是 SQLite/内存 adapter 的只读投影，不是新表或 durable fact。这样 snapshot 和续流不需要用 timestamp 猜跨 journal 的顺序。
- durability 仍由短间隔读取已提交事实续流；live chunk 另走 Runtime Host 的无 controller observer，断线后不会伪造补齐 live 内容。

## 遗留问题
<!-- 发现但本次不做的 -->

## 交接说明
2026-08-29：完成。`trajectory/` 是唯一 read seam；它读取现有 SQLite total order、Desktop catalog 和 Runtime Host observer，不写回任何事实。HTTP、SSE、ACP、Electron 和 UI 必须消费其 DTO，不得自行读取 persistence 或重做内容脱敏。
