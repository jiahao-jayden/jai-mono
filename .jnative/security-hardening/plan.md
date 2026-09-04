# 计划: 补齐 Desktop 侧信任边界与若干实现缺口

来源:需求说明 · 日期:2026-09-01 · 状态:⏳ 等待确认

请确认这些文件:intent.md + plan.md + todo.md + 全部 specs
开始条件:状态改为 `✅ 已确认 · 可执行` 前，只完善计划文件，不开始实现或修改正式代码。

## 背景

一次完整评审查出 11 个问题。评审结论是保留现有架构，补 Desktop renderer 侧缺失的信任边界。2026-09-01 用户决定做其中 10 项，凭据加密（问题 6）因为会让已存 API key 和 OAuth 授权全部失效而单独立需求。

现状的不对称很明显。Agent 侧有一次性 path capability、执行前 canonical 重检、tree-sitter Bash AST 分类、审批后重新求值这一整套 fail-closed 设计；Desktop renderer 侧没有 CSP、没有 `will-navigate`、`shell.openExternal` 不校验 scheme。Agent 输出会被当作可信内容一路渲染到 DOM 并触发系统动作。

## 方案

按三条线推进，彼此不互相阻塞。

**第一条线是 Agent 输出信任边界**，对应问题 1、2、3。在三个位置各设一道，任何一道单独失效都不至于让链路贯通：渲染层用 `urlTransform` 收协议，主进程的 `setWindowOpenHandler` 再收一次，`will-navigate` 挡住顶层导航，CSP 兜住剩下的远程资源加载。删掉 `index.html` 的 Google Fonts link 既是修复本身，也是 CSP 能收紧到 `default-src 'self'` 的前置。

**第二条线是权限判定的准确性**，对应问题 4。给 `isDestructiveBashCommand` 补动态执行器识别，不改扫描架构。

**第三条线是若干低成本健壮性修复**，对应问题 5、7、8、9、10、11。按 workspace 分组，因为验证命令不同。

三条线之间没有依赖，可以按任意顺序做。工作清单里的编号只表示优先级。

## 外部产品或规范的约定

**Electron Security Checklist**（一手来源:https://www.electronjs.org/docs/latest/tutorial/security ）。跟随程度为「行为参考」：只落实本次相关的三条（限制导航、限制新窗口创建、定义 CSP），不逐条对齐整份清单。`contextIsolation`、`sandbox` 已开（`app/desktop/electron/windows.ts:5-11`），`nodeIntegration`、`webSecurity` 走 Electron 默认值，本次不显式改写。

**react-markdown 的 `defaultUrlTransform`**（协议白名单 `/^(https?|ircs?|mailto|xmpp)$/i`）。跟随程度为「借鉴思路」：Streamdown 2.5.0 把它换成了恒等函数，我们在调用方补回等价约束，但收得更紧，只放行 `http:`、`https:`、`mailto:`，去掉 `ircs:` 和 `xmpp:`（本产品没有使用场景，多放行一个协议就多一个交给操作系统 handler 的入口）。

**Electron `safeStorage`**。本轮不用，留给后续的凭据加密需求。

## 需要先想清的事

| 维度 | 结论 | 依据 |
|---|---|---|
| 长期保存的数据与兼容 | 无需用户决定 | 只有 WAL 影响 `~/.jai/data.sqlite` 的落盘形态（多出 `-wal` / `-shm`），schema 与事实归属不变，owner 仍是 Runtime Host。其余九项不触碰长期保存的数据。 |
| 外部产品或规范的约定 | 已确认选择 | 见上节。协议白名单收紧到三个的理由已写明；Electron 清单按「行为参考」落三条。 |
| 用户和调用方看到的行为 | 已确认选择 | 三处可感知变化，都在「已确认的关键选择」里列明。 |
| 权限与安全 | 已经确定 | 这次改动全部是收紧，没有放宽任何现有边界。唯一需要注意的是别把正常功能一起收掉，写进风险。 |
| 运行环境和依赖 | 已经确定 | 不新增依赖。CSP 在开发与生产两套策略，开发环境要为 Vite HMR 放开 `connect-src` 的 ws 和 `script-src` 的 inline，这是 Vite 的既定要求，不是可选项。 |
| 同时操作和失败重试 | 已经确定 | WAL 让读不再阻塞写，是改善不是引入。abort 宽限超时会改变超时后的资源释放时机，写进风险。 |

## 已确认的关键选择

来自 2026-09-01 与用户的确认:

1. **凭据加密不在本轮**。理由是它会让已存的 API key、Connector credential 和 OAuth token 全部失效（项目规则不写 migration），用户要重新填写并重新授权。`provider.revealApiKey` 是否保留一并留给那个需求。
2. **其余 10 项全做**，不只做最优先三件。理由是后几项都是低成本改动，分开立需求反而要重复跑验证。

计划阶段自行确定、需要用户在确认时一并过目的:

3. **URL 协议白名单为 `http:`、`https:`、`mailto:`**。用户可感知的变化：agent 输出的 `file://` 链接点击后不再有任何反应。这是有意的。
4. **`EventStream` 的失败改为在迭代时抛出**，同时实现 iterator 的 `return()`。这是 `packages/ai` 的对外行为改变，按项目规则「不保留向后兼容」直接改，不加开关。
5. **abort 宽限超时定为 5 秒**。超时后放弃等待工具、把结果标记为 aborted，让 run 继续收尾。选 5 秒是因为内置工具的最慢清理路径是 bash 的 SIGTERM 到 SIGKILL 共 1 秒，留 5 倍余量。

## 没选的路

**在 DTO 投影时净化 agent 输出**。要维护一套随 markdown 特性漂移的净化规则，漏一条就等于没做，而且新增 DTO 字段会绕过它。

**把 transcript 渲染搬进 sandbox iframe**。这是 Electron 里渲染完全不可信内容的正确做法，但 agent 输出是用户自己发起会话产生的半可信内容，要重做 IPC 和布局，代价与收益不匹配。仓库里 workspace HTML preview 已经用了这个模式（`app/desktop/src/components/shell/workspace-panel.tsx:939-941`），需要时有先例可循。

**把 CSP 和外链白名单拆成两项之外的更细粒度**。CSP 一旦收紧就是全局生效，逐条放开只会让中间状态既不安全也不可用。

**给 `find` / `grep` 加 realpath**。只读工具，FFF 已关闭根目录与 home 扫描，收益低于改动风险。

## 风险

**CSP 会打破现有渲染，这是本次最危险的一步。** Streamdown 的代码高亮、表格全屏、mermaid 图、图片预览、`motion` 的动态样式都可能依赖 inline style 或 `blob:` / `data:` URL。`app/desktop/src/components/shell/workspace-panel.tsx` 的 HTML preview iframe 有自己的 CSP，要确认外层策略不会把它一起挡掉。这一项必须逐个页面手动验证，不能只靠类型检查和单测通过就标完成。

**协议白名单可能收掉正常功能。** 收紧前要确认 UI 里没有依赖非 http/https/mailto 链接的既有功能。已知 `jai:` 协议用于 OAuth 深链回调（`app/desktop/electron/main.ts:32-35`、`:111-121`），但它由 `open-url` 事件处理，不经过 `setWindowOpenHandler`，不受影响。

**abort 宽限超时会改变资源释放时机。** 超时后 run 收尾但工具进程可能还在跑，要确认不会产生重复的 tool result 或让 listener 收到已结束 run 的事件。

**`EventStream` 改动影响公开 SDK 消费者。** `packages/coding-agent` 的 `dist/sdk.d.ts` 是对外接口面，改完要跑 `test:consumer`；注意评审记录显示该脚本因 workspace 协议环境限制曾不可用（见 `.jnative/archive/sweep-thin-wrappers`），跑不起来时改为核对 dist 类型面并在 spec 里注明。

**MCP 副作用声明改动目前无法端到端验证。** Desktop runtime adapter 只为 `connector` extension 提供配置（`app/server/src/agents/connector.ts:37-41`），官方 MCP extension 拿到空配置，这条路没接通。只能靠单元测试证明。

## 必须遵守的项目规则

从 `AGENTS.md` 原文摘录，只列本次会碰到的条目。

错误处理:

> - 可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。
> - 领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。
> - `cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。

组件规则:

> 7. 修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。
> 8. `app/desktop` 的 JSX 属性，尤其 `className`，禁止模板字符串、字符串拼接和 JSX 内的条件表达式来组合值。组合 Tailwind class 必须使用 `@/lib/utils` 的 `cn`；条件 class 使用 `cn` 的对象或参数形式。

函数抽取规则:

> - 不要仅为了"看起来模块化"提取两三行命名函数。
> - 同时满足以下条件时直接内联：只有一个调用点；只是原样转发、别名或固定参数构造；没有分支、领域约束或资源生命周期；没有独立测试价值；函数名没有增加调用处无法表达的业务语义。
> - 不按行数机械内联。类型守卫、事件处理器、递归、协议边界、错误 DTO 投影、领域校验及多处复用函数可以保持短小。

架构与目录:

> - `main.ts`、`runtime.ts`、composition root 只负责装配与生命周期；`index.ts` 只定义模块对外 interface 和 re-export。它们不得承载领域规则、SQL、UI 投影或协议实现。
> - `app/desktop/electron/main.ts`、`preload.ts`、`runtime.ts` 是 Electron 入口与 composition root；`logger.ts`、`theme.ts`、`windows.ts` 是进程级系统能力。不要把新的产品领域文件继续平铺在 `electron/` 根目录。
> - `rpc/` 持有 IPC router、验证、错误 DTO、renderer 事件广播与 RPC 生命周期内的 attachment registry。

编码规则:

> 1. 不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。
> 2. 选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。
> 10. 禁止一个函数少于 3 行，不要做无意义的函数封装

## 要运行的检查

各 workspace 的 scripts 已现查（2026-09-01）。

| workspace | 命令 |
|---|---|
| `app/desktop` | `(cd app/desktop && bun run typecheck && bun test)` |
| `packages/coding-agent` | `(cd packages/coding-agent && bun run typecheck && bun test)`；改动涉及对外类型面时加 `bun run test:consumer` |
| `packages/agent` | `(cd packages/agent && bun run typecheck && bun test)` |
| `packages/ai` | `(cd packages/ai && bun run typecheck && bun test)`（`test` 脚本为 `bun test test/*.test.ts`，不含 e2e） |
| `packages/extension` | `(cd packages/extension && bun run typecheck && bun test)` |
| `app/server` | `(cd app/server && bun run typecheck && bun test)` |
| 全仓库 | `bun run lint` |

## 为什么这样拆分

八项，按三条线分组，编号表示优先级而非依赖。

第 01 项和第 02 项都属于 Agent 输出信任边界，但分开做。第 01 项（外链与导航）是纯粹的收紧，不会影响任何现有渲染，做完立刻消除评审里最严重的那条链。第 02 项（移除远程资源与加 CSP）有实打实的 UI 破坏风险，可能要反复调策略。合在一起会让最紧急的修复被 CSP 调试拖住。

第 04 到第 07 项按 workspace 分组，因为每组的验证命令和测试套件不同，分组后每项能独立跑完整检查、独立回滚。同一 workspace 内的多个小修复合成一项，避免为了两行改动重复跑一遍类型检查和测试。

第 03 项（Bash 动态执行器）单独一项，因为它是唯一改动权限判定语义的工作，需要配套补测试矩阵，和其他项的性质不同。

第 08 项（telemetry 内容体积上限）是 2026-09-04 复查 `8ca238b` 时追加的，不在最初的评审范围内。它和第 06 项同属 `app/server`，但没有合并:第 06 项改的是本地落盘与 socket 权限，第 08 项改的是出站内容的传输约束，两者的验证方式和失败模式都不同，合并只会让一次回滚牵连两类不相干的改动。
