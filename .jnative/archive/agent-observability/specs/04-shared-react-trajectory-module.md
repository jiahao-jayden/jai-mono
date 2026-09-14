# 04: 共享 React 轨迹界面模块

要先完成:02 · 状态:✅

## 交付什么

Browser 与 Desktop 的 host 可以向同一个 `TrajectoryDataSource` 提供数据，并得到一致的单 Session 轨迹体验：相同的 record identity 消费、snapshot/live 合并、loading/error/reconnect 状态、turn/model/tool 层级、选择联动和 `TrajectoryView`。host 不需要复制 reducer，界面模块也不需要知道 REST、SSE、Bearer、Electron IPC 或 SQLite。

## 范围

做:
- 新建以 trajectory 产品领域命名的 React package，暂定 `@jai/trajectory-ui`；实施时核对最终命名，但不得落入 `common`、`shared`、`utils` 等泛化目录；
- 只暴露小而稳定的 `TrajectoryDataSource` interface，以及 host 渲染共享视图所需的最小入口；
- 维护 wire-safe trajectory DTO 的客户端 reducer，统一 snapshot hydration、cursor event、record identity 去重/更新、Session 切换和 reconnect state；
- 实现可复用 `TrajectoryView`：Session 摘要、运行状态、turn 时间线、model attempt/stream/usage、tool timing、错误和选中 record 详情；
- 共享 loading、empty、error、reconnecting、cursor expired、content not granted 等状态和键盘/无障碍交互；
- 对 Browser/Desktop 真正不同的 host action、图标或 chrome 使用窄语义 slots/interface；只有两个实现确实变化时才建立 seam；
- 实施前读取并使用 `impeccable` 与适用组件 skill，核对仓库已有 React 19、Base UI、TanStack Query、日期和可访问性依赖，优先复用成熟方案；
- 在新 package 的真实 manifest 中创建 typecheck、test、build scripts，并在计划/spec 回填后执行；
- 通过 data source fakes 与 reducer/view tests 覆盖典型、空、密集、长文本、实时更新和错误状态。

不做:
- 不实现 Browser REST/SSE、token bootstrap、CSP、Browser navigation 或静态资源 host；
- 不实现 Electron IPC/push、Desktop route、window chrome 或 Session navigation；
- 不导入 SQLite、`@jai/agent` internals、Server internals、Electron、Desktop preload 或 Desktop store；
- 不依赖 Desktop 专属 path alias、`@/lib/icon-context`、`src/components/ui/*` 或 `cn` implementation；
- 不构建跨 Session dashboard、聚合图表、告警、编辑、重跑、取消或审批；
- 不为每个 mapper、slot 或 React child 建 factory/interface。

## 需要遵守的整体选择

- 它是“共享轨迹界面模块”，不是包含 transport/auth/host 的大 SDK（见 [plan「方案」](../plan.md#方案)）。
- `TrajectoryDataSource` 是 Browser 与 Desktop 两个真实 adapter 共享的 seam；wire-safe DTO 来自 Server contract（见 [plan「已确认的关键选择」](../plan.md#已确认的关键选择)）。
- Desktop 专属实现留在 Desktop host；共享 package 仅通过确有变化的窄语义 slots 接入（见 [plan「没选的路」](../plan.md#没选的路)）。

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。reducer state、selected record、expanded turn、cursor、reconnect 状态和 view state 都是可丢弃的客户端内存状态。共享轨迹界面模块不写 SQLite、Browser storage 或 Desktop metadata；长期事实仍由 Agent journals 与 Desktop catalog 的既有 owner 维护。

## 必须遵守的项目规则

- “Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal。”（`AGENTS.md`，「事实归属」）
- “目录首先按领域事实或角色命名，而非按泛化技术命名。新目录不得命名为 `data`、`common`、`shared`、`helpers`、`utils`、`services`、`misc`。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “依赖方向固定：……projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “通用组件能力不足时，优先补强共享组件或明确保留专用语义控件，不在多个业务组件中复制一套近似实现。”（`AGENTS.md`，「组件规则」）
- “优先用成熟的、有人维护的库。没有明确理由别自己重写。”以及“先翻项目里已有的依赖能做什么，再考虑加新包或自己写。”（`AGENTS.md`，「编码规则」）
- “不要仅为了‘看起来模块化’提取两三行命名函数。”（`AGENTS.md`，「函数抽取规则」）
- 实施时必须读取并遵循 `.agents/skills/impeccable/SKILL.md`；需要 shadcn registry 时再读取对应 skill。Browser/Desktop host 的专项规则不扩散到本 package。

## 风险

- `TrajectoryDataSource` 若包含 URL、token、Electron channel 或 CORS 参数，会变成 transport/auth SDK；必须只表达界面需要的读取、订阅、恢复和关闭语义。
- reducer 若按 transport event 类型分支，Browser/Desktop 行为会漂移；它只能消费统一 trajectory DTO 与 record identity。
- 过度抽象 host slots 会把 Desktop design system 复制进 package；只注入确实变化且能命名业务语义的能力。
- 共享样式若假设 Desktop Tailwind alias/theme，Browser build 会隐式依赖 Desktop；package 的 styling contract 必须可由两个 host 明确承载。
- 轨迹容易变成密集日志 dump；信息层级必须服务调试任务，并覆盖典型和极端内容范围。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] 新 package 为 `@jai/trajectory-ui`，拥有 trajectory 领域状态与 view，不使用泛化目录名；
- [x] `TrajectoryDataSource` 只表达 snapshot、subscribe 和 close，未泄漏 HTTP/SSE/Bearer/Electron/SQLite/Agent internal；
- [x] reducer tests 覆盖 snapshot、live identity 合并、Session reset、reconnect 与 cursor expired；
- [x] `TrajectoryView` tests 覆盖 metadata-only empty state；实际 Browser/Desktop 验收覆盖 loading、error、reconnecting、content-not-granted 与窄宽度；
- [x] package source 只依赖 React 和 wire DTO；没有 SQLite、Agent/Server、Electron 或 Desktop alias/UI/icon/cn 依赖；
- [x] 未引入 slot factory；Browser 与 Desktop 只各自实现一个真实的 data source；
- [x] 已使用 `impeccable` 的 Desktop operate/polish 指引与机械 detector，保留既有安静、低对比的 Desktop visual system；
- [x] `packages/trajectory-ui/package.json` 提供并已执行 `typecheck`、`test`、`build`：3 pass、0 fail；
- [x] 本次新增与改动源文件通过 `biome check`。全仓 `bun run lint` 已执行，但仍报告 138 个未触及历史文件的格式诊断，未为本项扩散格式化改动；

## 决策记录
- 共享包只管理不可持久化的 view state 和 wire DTO；content scope 由 host data source 决定，避免把 Browser capability 或 Desktop permission policy 带入 React package。
- 使用 record identity 统一 snapshot/live upsert；只有同一 live chunk identity 才在客户端临时拼接文本，durable stream 摘要从不携带 chunk 文本。

## 遗留问题
无。

## 交接说明
`@jai/trajectory-ui` 是 Browser 与 Desktop 唯一的 reducer/view owner。后续 host 只能实现 `TrajectoryDataSource`，不得复制状态机或 timeline UI。
