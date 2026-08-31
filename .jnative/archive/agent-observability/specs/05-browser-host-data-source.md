# 05: Browser host 与 data source

要先完成:03、04 · 状态:✅

## 交付什么

本机开发者可以在独立 Browser 页面打开单 Session trajectory。页面使用共享 `TrajectoryView` 和 reducer，通过 `/v1` REST/SSE 展示 durable 历史与实时变化；token 只在启动时进入内存并立即从地址栏清除，默认只展示 metadata。

## 范围

做:
- 新建 Browser workspace，在真实 manifest 中建立 dev、typecheck、test、build 和浏览器自动化 scripts；
- 使用 REST snapshot 与可设置 `Authorization` 的 fetch-based SSE 实现 `TrajectoryDataSource`；
- 负责 scoped token fragment bootstrap、立即清除地址凭据、CSP/no-referrer、静态资源和 Browser navigation；
- 接入共享 `TrajectoryView`、reducer、record identity 与 loading/empty/error/reconnecting/cursor-expired 状态，不复制其实现；
- 默认使用 metadata capability；只有本机入口显式签发内容 capability 时才显示相应白名单内容；
- 实施前读取并使用 `impeccable` 与适用组件 skill，先核对仓库现有成熟 React/Vite/UI 依赖；
- 用真实 Runtime Host 和浏览器自动化验证桌面/窄屏、键盘、对比度、snapshot/live、断线重连、scope 与 token hygiene。

不做:
- 不实现 Desktop Main、ACP trajectory adapter、Electron IPC/push 或内嵌页；
- 不通过 iframe/webview 复用 Browser 页面；
- 不直接读 SQLite、Agent/Server internals，不自行 join trajectory 或定义第二套 DTO；
- 不把 REST/SSE、Bearer、Browser navigation 或 CSP 放入共享轨迹界面模块；
- 不使用原生 `EventSource` + query token，不持久化 token/trajectory content；
- 不实现最终 product composition rollback 或跨 Browser/Desktop E2E matrix。

## 需要遵守的整体选择

- Browser 只通过 `/v1` REST/SSE 消费 Server read-only trajectory module（见 [plan「方案」](../plan.md#方案)）。
- Browser adapter 是 `TrajectoryDataSource` 的一个真实实现；共享 view 不感知 transport/auth（见 [plan「已确认的关键选择」](../plan.md#已确认的关键选择)）。
- Desktop 的 ACP/IPC 链路完全不在本项范围（见 [plan「为什么这样拆分」](../plan.md#为什么这样拆分)）。

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。Browser token、cursor、SSE connection、selected record 和 reducer state 都是可丢弃内存状态。Browser 不写 SQLite，也不使用 localStorage、sessionStorage、IndexedDB 或 cache 持久化 token/trajectory content。

## 必须遵守的项目规则

- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影。”（`AGENTS.md`，「错误处理规则」）
- “Projection 是单向读取模型……不得把 projection、UI state、Desktop metadata 写回 journal。”（`AGENTS.md`，「事实归属」）
- “优先用成熟的、有人维护的库。没有明确理由别自己重写。”以及“先翻项目里已有的依赖能做什么，再考虑加新包或自己写。”（`AGENTS.md`，「编码规则」）
- “组件保持模块化，关注点分离。”（`AGENTS.md`，「编码规则」）
- 实施时必须读取并遵循 `.agents/skills/impeccable/SKILL.md`；需要 shadcn registry 时读取对应 skill，并使用真实浏览器自动化。
- `app/desktop` 的 UI/icon/cn 专项条款不适用于独立 Browser workspace，不得据此引入 Desktop 专属依赖。

## 风险

- fetch-based SSE 的 UTF-8/frame/abort/reconnect 容易写错；优先采用成熟维护库，不手写脆弱 parser。
- token fragment 清理过晚会进入复制地址、截图或扩展读取；bootstrap 第一阶段必须提取并 replaceState。
- 静态 fixture 无法发现 CORS/SSE/capability 问题；自动化必须连接真实 Runtime Host。
- Browser workspace 当前不存在；必须先创建真实 scripts，再回填验证命令，不能使用计划占位。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] `app/trajectory-browser/package.json` 提供 `dev`、`typecheck`、`test`、`build`、`test:browser`；所有脚本均已执行；
- [x] Browser data source 只消费 `/v1` 的 wire DTO，使用 `eventsource-parser` 解析 authenticated fetch SSE；没有 Agent/Server internals、SQLite、Electron 或 Desktop imports；
- [x] 页面直接复用 `TrajectoryView` 和 `useTrajectory`，没有 Browser 私有 reducer；
- [x] production Browser 验证了 snapshot/live、nonce 立即清除、metadata/content scope、重连、cursor expired 与 Host restart；`test:browser` 额外验证 nonce bootstrap：3 pass、0 fail；
- [x] Bearer 只在 JS 内存：DOM、Storage、URL query、network URL、console 和缓存均无 capability；
- [x] CSP、`no-referrer` 与无第三方 runtime request 已在 production network/console 检查中确认；
- [x] 宽窄截图、键盘 focus、empty/error/reconnect/content-not-granted 状态已检查；
- [x] 已使用 `impeccable` 检查 Browser 与 Desktop 的视觉连续性；detector 仅给出 3 个有意的 Browser 独立色阶和 1 个字号 advisory；
- [x] `cd app/server && bun run typecheck`；使用 Bun 1.4.0 的 `cd app/server && bun test`：124 pass、0 fail；
- [x] `cd app/trajectory-browser && bun run typecheck && bun test && bun run build && bun run test:browser`；
- [x] 本次新增与改动源文件通过 `biome check`；全仓历史 lint 基线见 Spec 04；

## 决策记录
- Browser token bootstrap 使用一次性 launch nonce，而非 Bearer fragment；`history.replaceState` 在换取 capability 后立即移除 nonce。
- 不使用原生 `EventSource`，因为它无法携带 Authorization header；fetch streaming + `eventsource-parser` 保持 Bearer 在 header，且支持 cursor 恢复。

## 遗留问题
无。第一版不提供 Browser 多 Session 导航或跨 Session 聚合。

## 交接说明
Browser host 已可从 CLI launch；Bearer 生命周期仅在 Browser 内存。Desktop 必须继续走 ACP/IPC，不能复用此 data source 或 HTTP capability。
