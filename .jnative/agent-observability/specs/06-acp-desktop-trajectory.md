# 06: ACP 只读轨迹协议与 Desktop 内嵌页

要先完成:02、04 · 状态:✅

## 交付什么

Desktop 用户可以从当前 Session 打开内嵌 trajectory，并看到与 Browser 相同的 `TrajectoryView`、record identity 和交互状态。数据链固定经过 Server 现有本机 ACP v2 连接上的 JAI namespaced read-only trajectory protocol、Desktop Main 现有 `LocalAcpV2Client`、Electron main/preload IPC + push 和 Desktop `TrajectoryDataSource`；观察者不取得 Session controller，也不阻塞或影响正在执行的 Agent。

## 范围

做:
- 在 Server 现有本机 ACP v2 connection 上增加 JAI namespaced read-only trajectory snapshot/observe protocol adapter，只调用 spec 02 的 Server interface；
- 协议使用同一 wire-safe trajectory DTO、cursor 与白名单错误 DTO，支持 snapshot、从 cursor 观察、cursor expired、unsubscribe 和 connection close；
- observer 以 Session id 打开独立只读 feed，不取得/抢占 controller，不调用可写 RuntimeSession open，不触发 prompt/resume/recovery/approval；
- 慢 consumer、client disconnect、listener throw 和 subscription close 与 Agent execution 隔离；
- Desktop Main 复用现有 `LocalAcpV2Client` 消费 namespaced protocol，不新建直连 Server internal 的 transport；
- Electron main/preload 将 snapshot request 与 push event 投影为显式 IPC 白名单 DTO，管理 renderer reload、Session switch、window close、cursor expired 和 unsubscribe；
- Desktop renderer 实现 `TrajectoryDataSource`，接入共享 `TrajectoryView`、reducer、record identity 和 loading/error/reconnect 状态；
- 增加当前 Session 的 Desktop 内嵌 trajectory 导航与 host chrome；默认 metadata，内容显示须由 Desktop 中显式用户动作选择 scope；
- 遵守 Desktop UI component、icon context、`cn` 和专项检查规则，使用 `impeccable`/适用组件 skill，并做真实 Electron/renderer 验证。

不做:
- Server 不导入 Electron，不提供或依赖 Electron protocol adapter；
- Desktop 不请求 localhost REST/SSE，不取得、不代理、不持久化 Browser bearer capability；
- 不把 trajectory method/event 塞入 desktop catalog 或 desktop configuration 私有通道；
- observer 不取得 Session controller，不暴露 prompt/cancel/approval/configuration 等写能力；
- 不让 preload/renderer 直接访问 `LocalAcpV2Client`、SQLite、Agent/Server internals；
- 不复制共享 reducer/view，不用 iframe/webview；
- 不实现 Browser host 或最终跨 host composition/E2E matrix。

## 需要遵守的整体选择

- 依赖方向固定为 Server module → JAI namespaced ACP read-only adapter → Desktop Main `LocalAcpV2Client` → Electron IPC/push → Desktop data source → shared view（见 [plan「方案」](../plan.md#方案)）。
- ACP trajectory observer 与 Session controller 是不同 seam；观察不能影响执行（见 [plan「风险」](../plan.md#风险)）。
- Desktop 不复用 Browser HTTP/auth，Server 不感知 Electron（见 [plan「没选的路」](../plan.md#没选的路)）。

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。ACP observer/subscription、IPC subscription、renderer cursor、selected record 和 reconnect state 都是可丢弃状态。Session/Operation/timing facts 仍由 Agent journals 维护，title/project 仍由 Desktop catalog 维护；本协议与页面都不写回。

## 必须遵守的项目规则

- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”（`AGENTS.md`，「错误处理规则」）
- “Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal。”（`AGENTS.md`，「事实归属」）
- “依赖方向固定：……adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “`app/desktop` 的产品界面优先复用 `src/components/ui/*`；已有等价组件时，不直接书写原生交互元素或重复实现 hover、focus、loading、disabled 等状态。”（`AGENTS.md`，「组件规则」）
- “Desktop 业务组件通过 `@/lib/icon-context` 的 `useIcon` / `useIcons` 使用图标；缺少图标时在 `IconName` 与 `defaultIcons` 中补充 Hugeicons 映射。”（`AGENTS.md`，「组件规则」）
- “修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。”（`AGENTS.md`，「组件规则」）
- “`app/desktop` 的 JSX 属性，尤其 `className`，禁止模板字符串、字符串拼接和 JSX 内的条件表达式来组合值。组合 Tailwind class 必须使用 `@/lib/utils` 的 `cn`……”（`AGENTS.md`，「组件规则」）
- 实施时必须读取并遵循 `.agents/skills/impeccable/SKILL.md`；需要 shadcn registry 时读取对应 skill。

## 风险

- 若 observer 复用 controller-scoped Session open，会抢占 Desktop/CLI controller 或触发恢复，直接改变 Agent 行为；必须有并发执行测试证明隔离。
- ACP connection 既承载 Agent protocol 又承载 trajectory push；慢 observer 不能阻塞请求处理、Agent event 发布或其他 Session。
- renderer reload/Session switch 时旧 push 若未取消，会污染新 Session reducer；Desktop Main 必须按 subscription identity 和 cursor 管理。
- IPC 若转发内部 error/journal object，会泄露 stack/cause；main/preload 两侧都要 schema 白名单。
- 把 trajectory 塞进 catalog/config 私有通道看似省事，却会混淆 owner 与生命周期，必须通过模块依赖检查拒绝。
- Desktop 当前没有 test script；实施时先创建真实 script 并回填，计划不能伪造。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] ACP namespaced trajectory adapter 仅调用 Server `TrajectoryFeed`；source check 无 Electron import，未进入 catalog/config private channel；
- [x] observer 从独立只读 feed 订阅，不调用 Session controller open、prompt、resume、recovery 或 approval；ACP tests 覆盖 controller 隔离；
- [x] 执行中的 Agent 旁路打开、关闭、重连 observer 不改变 controller ownership 或结果；慢 listener、disconnect 与 unsubscribe 也不回压 Agent；
- [x] ACP、IPC 和 push 只投影 wire-safe trajectory/error DTO，不携带 stack、cause、SDK 或 journal object；
- [x] Desktop Main 复用 `LocalAcpV2Client`，preload/renderer 只使用 Desktop RPC；
- [x] `acp-host.test.ts`、`desktop-router.test.ts` 覆盖 reload-safe subscription、Session 切换、cursor expired 与 unsubscribe；真实 Electron renderer 已验证；
- [x] Desktop renderer 用 `createDesktopTrajectoryDataSource` 接入共享 `TrajectoryView`，不复制 reducer 或 view；
- [x] renderer 未发起 localhost trajectory HTTP，也不接触 Browser bearer；
- [x] `trajectory-page.tsx` 复用 shared `Button` 和 `useIcon`，条件 class 使用 `cn`；
- [x] diff-only Shell scan 未发现新增原生 `<button>`、直接图标库 import 或 JSX class 拼接；
- [x] 已使用 `impeccable` 的 Desktop operate/polish 指引；production Electron 截图验证 Live、empty state 与“显示最终文本”显式 scope 开关；
- [x] `cd app/server && bun run typecheck`；Bun 1.4.0 `cd app/server && bun test`：124 pass、0 fail；
- [x] `cd app/desktop && bun run typecheck && bun test && bun run build`：122 pass、0 fail；
- [x] Desktop 已有真实 `bun test` script；`@jai/trajectory-ui` 的 typecheck/test/build 已通过；
- [x] 本次新增与改动源文件通过 `biome check`；全仓历史 lint 基线见 Spec 04；

## 决策记录
- Electron Runtime Host 改为 `utilityProcess.fork` 并保持 `RunAsNode: false`，使 packaged Node Runtime Host 能承载 trajectory HTTP；utility stderr 在最终产物恢复为 `ignore`，不把运行时诊断泄漏给 Desktop 用户。
- Desktop 默认 metadata-only；“显示最终文本”是显式用户动作，只扩大本次 read projection，不持久化 scope 或 capability。

## 遗留问题
无。Desktop 不提供 Browser launch/token 管理，也不直接消费 HTTP。

## 交接说明
Desktop 路径固定为 ACP→Main→IPC/push→`TrajectoryDataSource`→共享 view。最终装配只需验证两个 host 的完整启动和资源关闭，不能为复用改走 HTTP。
