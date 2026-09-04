# 需求说明: 补齐 Desktop 侧信任边界与若干实现缺口

日期:2026-09-01

来源:一次以独立软件架构师 / 安全评审人身份对整仓做的完整评审。评审结论认为分层、SQLite 单一 journal、OAuth 分工、遥测隐私模型、Agent 侧路径沙箱都应当保留，路线判定为「调整当前方案」，不是重构。

## 问题

Agent 侧的安全工程做得很细：一次性 path capability、执行前 canonical 重检、tree-sitter 解析 Bash AST 后分类危险命令、解析失败一律降级为需要审批、审批返回后重新读 workspace root 和 settings 再判一次。这些设计说明作者清楚 TOCTOU 和 fail-closed 该怎么做。

Desktop renderer 侧的等价边界几乎不存在。全仓库没有 `will-navigate`、没有 CSP、没有 `setPermissionRequestHandler`，`shell.openExternal` 收什么 URL 就交给操作系统打开。Agent 输出是不可信内容（一个会读 README、issue、网页的 coding agent 必然把外部文本引入模型上下文，prompt injection 是常态威胁），但从 `acp-host.ts` 把 agent 文本投影成 DTO，到 Streamdown 渲染成 DOM，再到 Chromium 交给 `setWindowOpenHandler`，全程没有一环把它当不可信数据处理。Agent 层的严谨没有延伸过进程边界。

受影响的是全部桌面用户，让 agent 处理外部仓库、抓取网页或阅读他人 issue 的用户风险更高。

同一次评审还查出四类与该根因无关、但值得单独处理的实现缺口：Bash 危险扫描漏掉动态执行器、凭据明文落盘、SQLite 未启用 WAL、abort 完全依赖工具协作。

## 期望结果

- Agent 产出的内容无法通过 renderer 触发 `http:` / `https:` 之外的系统动作，顶层导航离开应用自身 origin 被拦截。
- 应用启动不再发起任何用户没有发起的网络请求，产品的「数据不离开机器」承诺在启动路径上成立。
- `eval`、`node -e` 这类动态执行器被 Bash 危险扫描识别，不会在 `bypassPermissions` 或已有 allow 规则下静默放行。
- 主进程不再信任 renderer 声称的任意文件路径。
- 几项低成本健壮性修复：WAL、abort 宽限超时、EventStream 失败语义、MCP 工具副作用声明。

## 影响范围

会改到的模块:

| 模块 | 改什么 |
|---|---|
| `app/desktop/electron/windows.ts` | `setWindowOpenHandler` scheme 白名单、注册 `will-navigate`、CSP 注入 |
| `app/desktop/index.html` | 删远程字体 link 与过时 title |
| `app/desktop/src/components/ui/chat-message.tsx` | 给 Streamdown 显式传 `urlTransform` |
| `app/desktop/electron/rpc/attachments.ts` | 路径来源约束，顺带换掉裸 `Error` |
| `packages/coding-agent/src/permissions/rules.ts` | 动态执行器识别 |
| `app/server/src/persistence/sqlite/*.ts` | WAL pragma |
| `app/server/src/runtime/local-owner.ts` 或 socket 创建处 | socket 权限 |
| `packages/agent/src/core/agent-loop.ts` | abort 宽限超时 |
| `packages/ai/src/event-stream.ts` | iterator `return()` 与失败传播 |
| `packages/extension/src/mcp/runtime.ts` | 按 annotation 判定 sideEffect |

长期保存的数据与维护方:

WAL 会改变 `~/.jai/data.sqlite` 的落盘形态（多出 `-wal` / `-shm` 两个文件），owner 仍是 Runtime Host，schema 和事实归属都不变。

其余改动都不触碰长期保存的数据。

## 边界

这次不做:

- OS 级沙箱。`bash` 以当前用户身份运行、继承完整环境变量，是 README 已声明的取舍，容器隔离是产品给出的答案。
- Bash 只读白名单的路径检查。它是策略分类而非效果沙箱，和上一条属于同一条已声明边界。
- 分层重构。依赖方向已核实为零违规。
- OAuth 网关改动。PKCE、state 归属、redirect 白名单、无 CORS 都已正确。
- 遥测隐私模型改动。内容治理经得起检查，默认关闭。
- `find` / `grep` 的 realpath 化。只读工具，FFF 已关闭根目录与 home 扫描。
- 把 transcript 搬进 sandbox iframe。评审比较过三条路线，这条代价与收益不匹配。
- `app/cli`、`app/docs`、UI 组件层、`packages/ai` provider 字段映射的审查。风险密度明显低于已审区域。
- 文档滞后的修订（README 缺三个 workspace、Electron 版本号、AGENTS.md 提到的不存在目录）。可以顺手带，但不作为本需求的目标。
- **凭据加密（问题 6）**。2026-09-01 用户决定推迟，单独立需求。理由是它会让已存的 API key、Connector credential 和 OAuth token 全部失效（项目规则不写 migration），用户要重新填写并重新授权，代价和本轮其余改动不在一个量级。`provider.revealApiKey` 是否保留一并留到那个需求里决定。本轮其余改动不依赖它，也不会让它更难做。

## 工作量

大。2026-09-01 用户决定做 11 项中除凭据加密外的 10 项。

两个理由。一是根因项（renderer 信任边界）涉及主进程、renderer 和第三方库默认值三处配合，且 CSP 在开发与生产环境的策略不同，需要独立验证。二是剩下的修复分布在 `app/desktop`、`packages/coding-agent`、`packages/agent`、`packages/ai`、`packages/extension`、`app/server` 六个 workspace，验证命令各不相同，分开做才能分别验证、分别回滚。

按评审给出的优先级，至少要拆成:renderer 信任边界、Bash 动态执行器、attachment 路径来源、以及按 workspace 分组的若干低成本修复。

## 已确认的现状

以下都是本次评审读代码得到的事实，未修改任何代码。工作树干净，`main` 最新提交 `30835f2`。

### 根因链已完整验证

`app/desktop/electron/windows.ts:26-29` 把 `details.url` 无校验交给 `shell.openExternal`。Assistant 消息经 `app/desktop/src/components/ui/chat-message.tsx:238` 交给 Streamdown 2.5.0，其 `MarkdownA` 渲染为 `<a href={o} rel="noreferrer" target="_blank">`，`target="_blank"` 必然进入 `setWindowOpenHandler`。

Streamdown 分叉 react-markdown 时把默认 URL 清理函数换成了恒等函数（编译产物中 `on = e => e`），且清理逻辑外还有一层门禁：只有传了 `allowElement`、`allowedElements`、`disallowedElements`、`skipHtml`、`urlTransform` 之一才执行。`chat-message.tsx:82-94` 一个都没传，该分支完全不运行。react-markdown 原本用 `/^(https?|ircs?|mailto|xmpp)$/i` 挡住的协议在这里全部放行。

react-dom 19.2.4 会拦 `javascript:`（client production bundle 内有 blocking 逻辑），所以不构成 renderer XSS。`file:`、`itms-apps:`、`vscode:` 及本机注册过的任何自定义 scheme 畅通到达 `shell.openExternal`；macOS 上 `file:///path/to/Something.app` 会启动该应用。

### 全部问题清单

| # | 问题 | 严重度 | 置信度 | 性质 |
|---|---|---|---|---|
| 1 | Agent 输出的链接可用任意 URL scheme 触发 `shell.openExternal` | 高 | 高 | 根因 |
| 2 | 生产 renderer 无 CSP，且从 `fonts.googleapis.com` 加载远程 CSS | 高 | 高 | 同根因 |
| 3 | 未注册 `will-navigate` | 中 | 高 | 同根因 |
| 4 | Bash 危险扫描漏掉 `eval`、`node -e`、`sh script.sh`、`base64 \| sh` | 中 | 高 | 根因 |
| 5 | `attachment.register` 接受任意绝对路径 | 中 | 中 | 表面症状，依赖 1/3 |
| 6 | 凭据明文落盘，且 renderer 可读回明文 API key | 中 | 高 | 根因 · **本轮不做，单独立需求** |
| 7 | SQLite 未启用 WAL | 中 | 中 | 根因 |
| 8 | abort 完全依赖工具协作，无超时兜底 | 中 | 中 | 根因 |
| 9 | `EventStream` 失败可能成为 unhandled rejection | 低 | 中 | 根因 |
| 10 | 官方 MCP 工具一律声明为 `read` | 低 | 高 | 根因，目前未激活 |
| 11 | Unix socket 无显式权限设置 | 低 | 中 | 根因 |

### 逐条证据

**#2** `app/desktop/index.html:7` 的 `<link>` 加载 Inter 与 Playfair Display，这两个字体在 `app/desktop/src/styles/global.css` 的字体栈里一次都没出现；设计系统用的 Manrope 与 Source Serif 4 已通过 `@fontsource-variable/*` 本地打包（`global.css:1-2`），IBM Plex Mono 走系统回退。`<title>` 仍是旧产品名 `noa.`。这是早期原型残留，且 Vite 构建不会移除。主窗口既无 CSP meta 也无 `session.webRequest.onHeadersReceived` 注入；仓库里唯二的 CSP 在 OAuth 回调页（`electron/oauth/callback-server.ts:109-116`）和 workspace preview iframe（`src/components/shell/workspace-panel.tsx:939-941`），都保护不到主页面。

**#3** 当前 Streamdown 链接都带 `target="_blank"`，走 `setWindowOpenHandler` 而非顶层导航，没有已知触发点。缺的是纵深防御：主窗口一旦被导航到远程页面，preload 桥仍有效，而 IPC server 不检查 sender frame origin（`electron/rpc/server.ts:30-45`），远程页面即获得完整 `desktopRpc.invoke`，包括 `provider.revealApiKey`。

**#4** `packages/coding-agent/src/permissions/rules.ts:115-117` 的解释器只在带 `-c`、`$()` 或反引号时判为 destructive；`-e` 不在检查内，`eval` 根本不在 executable 列表。默认模式下这些命令仍会弹审批，风险有限；但在 `bypassPermissions` 或用户为某解释器点过「总是允许」之后会直接放行。root 熔断（`permissions/evaluate.ts:346-375`）通过 tokenize 找 `rm` 判断，`eval 'rm -rf /'` 的 executable 是 `eval`，引号内是单 token，熔断不触发。`packages/coding-agent/test/permissions.test.ts` 覆盖了 `&&`、管道、引号操作符、`$()`、重定向、`/bin/rm` basename、`find -exec`，唯独没有这一类。

**#5** `electron/rpc/attachments.ts:29-41` 只 `stat` 校验是文件且大小一致，schema（`shared/desktop-rpc.ts:480-488`）只校验非空字符串，没有 workspace containment，也没有强制路径来自 `webUtils.getPathForFile`。同处 `:32-33` 两个裸 `throw new Error(...)` 违反项目错误处理规则，虽然外层 catch 会包成 `TaggedError`。

**#6** Provider API key、Connector credential、OAuth access/refresh token 全部序列化进 `runtime_agent_settings.settings_json`（`app/server/src/config/runtime-agent-settings.ts:655-678`），Langfuse key 在独立表但同样明文（`app/server/src/telemetry/credentials.ts:50-59`）。全仓库无 `safeStorage`、无 keytar、无任何加密调用。`forge.config.ts:55-63` 的 `EnableCookieEncryption` 只管 Chromium cookie。`provider.revealApiKey` 让 renderer 读回明文（`runtime-agent-settings.ts:460-482`，UI 调用在 `src/components/shell/app-shell.tsx:240-243`）。OAuth token 与 Langfuse secret 没有对应 reveal RPC，投影层正确过滤（`runtime-agent-settings.ts:1315-1331`）。

**#7** `app/server/src/persistence/sqlite/product-session-persistence.ts:371-372` 与 `desktop-catalog.ts:337-338` 只设了 `foreign_keys` 和 `busy_timeout = 5000`。正常路径有 Runtime Host 独占 owner lock 保护（`app/server/src/protocol/acp-v2/local-host.ts:73-84`），但 rollback journal 模式下长读事务遇写入时 5 秒超时会抛 `SQLITE_BUSY`，包成 `ProductSessionAdmissionConflict` 冒给用户。无多连接争用测试。

**#8** `packages/agent/src/core/agent-loop.ts:600-622` 直接 await 工具执行，无 race 无超时，并行模式还 `Promise.all` 等全部。内置工具都正确处理 signal，bash 清理尤其完整（进程组 SIGTERM，1 秒后 SIGKILL，listener 全摘，`harness/node/environment.ts:445-483`）。风险在扩展面：一个忽略 `AbortSignal` 的远程 MCP 调用会挂住整个 run、`waitForIdle()` 和所有 listener，用户点「停止」无反应。`packages/ai/test` 无任何 AbortController 测试。

**#9** `packages/ai/src/event-stream.ts:49-57` 的 `fail()` 只 reject 独立 result Promise，iterator 正常结束不抛。Agent 内部消费 provider stream 时都调了 `result()`（`agent-loop.ts:384-417`），风险在公开 SDK 消费者。同类未实现 iterator `return()`，消费者提前 break 不取消 producer。

**#10** `packages/extension/src/mcp/runtime.ts:239-246` 把远程 MCP server 的任意工具标成 `read`，不读 annotation；按 `permissions/middleware.ts:291-306`，`read` + 无敏感标记直接放行。Agent Plugin 路径正确标成 destructive + sensitive（`agent-plugins/index.ts:78-84`）。目前不触发：Desktop runtime adapter 只为 `connector` extension 提供配置（`app/server/src/agents/connector.ts:37-41`），官方 MCP extension 拿到空配置。

**#11** Runtime Host socket 承载无认证的高权限 RPC，含 `jai/desktop-configuration/reveal-api-key`（`app/server/src/protocol/desktop-configuration/control.ts:72-77`）。只给 lock 文件设了 0600（`app/server/src/runtime/local-owner.ts:48`），socket 本身无 chmod，权限受 umask 影响。

### 已确认无需处理的部分

依赖方向零违规（`packages/agent` 无反向依赖，`core` 不碰 harness 与 Node adapter，`packages/agent/test/harness/node/exports.test.ts:52-64` 用静态图断言根入口不含 node builtin，renderer 零 Electron / 零 agent 内部 import）。durable fact 单一 owner 落实，无 JSONL 双写、无 fallback、无第二 durable adapter；唯一 JSONL 是 telemetry 可删除诊断文件（`packages/telemetry/src/node/local-sinks.ts:25-36`）。无 SQL 注入面。无硬编码凭证。OAuth 设计正确（PKCE、state 与 verifier 留在 Runtime Host 内存、256-bit 随机、2 分钟 TTL、一次性消费、redirect 全来自部署配置、无 CORS 中间件）。Langfuse 不发送 prompt / 代码 / 工具输入输出 / API key，有专门测试断言（`app/server/test/telemetry/langfuse-otlp.test.ts:149-152`），默认关闭。RPC 错误投影不泄漏 stack、cause、原始 message，有测试（`app/desktop/test/rpc-error.test.ts:11-38`）。`dontAsk` 模式语义与文档一致（`app/docs/content/docs/guides/permissions.mdx:27`），且未在 Desktop UI 暴露。

### 评审中发现的文档滞后

`README.md:99-113` 的目录表缺 `app/server`、`app/connector`、`app/oauth-gateway`。`AGENTS.md` 的 Desktop 目录地图提到 `electron/connector/`，实际不存在，Connector runtime 在 `app/server/src/agents/connector.ts`；同处提到的 `@jai/agent/node/sqlite` 入口也不存在，SQLite adapter 在 `app/server/src/persistence/sqlite/`。`README.md:157-161` 声明 Electron 43，`app/desktop/package.json:108` 是 `42.7.0`。判断一律以代码为准。

## 参考对象

- Electron 官方 Security Checklist —— 本次要补的 `will-navigate`、`setWindowOpenHandler` 白名单、CSP 都是其中的标准条目。跟随程度待定，计划阶段确认按哪几条落地。
- react-markdown 的 `defaultUrlTransform`（协议白名单 `/^(https?|ircs?|mailto|xmpp)$/i`）—— Streamdown 去掉了它，本次要在调用方补回等价约束。是否原样采用这个白名单（例如要不要保留 `mailto:`）待确认。
- Electron `safeStorage` —— 凭据加密的候选实现，依赖操作系统 keychain。本轮不用，留给后续的凭据加密需求。
