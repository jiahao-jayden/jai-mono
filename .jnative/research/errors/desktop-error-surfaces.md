# Desktop 错误出口与跨进程错误链路现状

核验日期：2026-09-26，基于 `main` 工作树（`3272263` 之后含未提交的 `agent_error` 改动）。只读调查，来源为三次代码审计，关键结论已人工抽查。

## 结论

1. **错误分类信息在跨进程时几乎全部丢失。** provider 层 `ProviderErrorInfo` 保留 `status`/`code`/`type`/`requestId`（`packages/ai/src/adapter.ts:163-186`），但 ACP `agent_error` 只发 message（`app/server/src/protocol/acp-v2/agent.ts` `agentErrorUpdate`），Desktop `DesktopErrorItem` 只有 `id`/`message`/`timestamp`。
2. **Desktop IPC 信封只剩 `_tag`。** `projectDesktopRpcError` 把 message 固定为 `"Desktop request failed."`（`app/desktop/electron/rpc/error.ts:4-13`），renderer 的 `getDesktopRemoteRpcFailure` 只返回 `tag`/`reason`（`app/desktop/src/lib/desktop.ts:62-68`）。ACP numeric code 只进 `cause`，被丢弃。
3. **renderer 的错误文案映射有一半没有真实来源。** `chatFailureMessage`（`app/desktop/src/hooks/use-chat.ts:694-758`）匹配的 `desktop_provider.*`、`desktop_agent.creation_failed` 在生产代码里没有定义；`runtime_error.error.code` 实际传的是自然语言（`acp-host.ts` `#emitRuntimeError`），因此多数落到兜底文案。映射与 `use-chat.ts` 其他本地错误全是硬编码中文，不走 i18n。
4. **Toast 用 Base UI 默认值且从不带 action。** 5 秒、右下角、最多 3 条（`app/desktop/src/components/ui/toast.tsx:21-31`，`ToastProvider.d.ts`）。11 个调用点只用 `success`/`error`，全部没有 action；聊天错误 toast 显示后立即 `dismissError()`（`chat-column.tsx:248-257`）。
5. **同类失败呈现方式不一致。** 项目加载失败同时出现在侧栏 inline、ChatColumn toast、Project Picker、Chat header 四处；设置页各自维护 inline error；Workspace/Terminal/Subagent/Transcript error 缺 `role="alert"`；Subagent 历史与 MCP 行直接显示原始异常文本。
6. **存在一批用户触发却静默失败的路径。** 例如 terminal attach/close/write、原生目录选择器、代码块复制、默认模型选择持久化、项目排序/展开、MCP 状态刷新失败被显示成“没有 server”。后台降级（代码高亮、favicon、native menu icon）静默属于合理降级。
7. **安全策略不一致。** `agent_error.message` 经 `redactSecrets`；`state_update.errorMessage` 未脱敏且被 CLI 写入 diagnostics；私有 configuration/catalog control 通道原样返回后端 message（`protocol/desktop-configuration/control.ts:193-203`）。
8. **`@jai/common` 已删除。** `.jnative/research/errors/common-error-helpers.md` 中的 `ErrorEnvelope`/`toErrorEnvelope` 描述已过时；当前 Desktop 使用本地 `errorEnvelopeSchema`（`desktop-rpc.ts:159-174`）。
9. **Context overflow 被压成普通 error。** Anthropic 能映射出 `stopReason: "contextOverflow"`，Runtime 终态统一成 `RuntimeStopReason: "error"`；OpenAI 的上下文溢出只以 HTTP 400 + `context_length_exceeded` 出现。

## 错误类别与当前呈现

| 类别 | 当前呈现 |
|---|---|
| 发送前校验（未选模型、附件超限） | 硬编码中文 toast；附件 inline alert |
| 用户操作的 RPC 失败（重命名、归档、复制、打开文件） | i18n error toast，无 action |
| Provider/模型失败（401/429/5xx/网络） | transcript `DesktopErrorItem`（原始 message）；无分类、无操作 |
| Operation/runtime 失败（无具体原因） | 硬编码中文 toast “当前响应未完成” |
| 连接丢失 / Runtime Host 重启失败 | 聊天列黄色 banner，部分有重试 |
| 设置加载/保存失败 | 各页 inline alert 或空状态，重试语义不一致 |
| 面板数据加载失败（workspace、git、subagent、MCP） | 空状态或红字，多数无 alert 语义 |
| 静默失败 | 见结论 6 |

## Synara 参考（`/Users/jayden/code/github_project/synara`）

- Toast：Base UI，`top-center`、默认 10 秒、z-200、`max-w-sm`；卡片 `bg-popover/94 backdrop-blur-xl border shadow-lg/10`，错误态用 destructive 5% 背景 + 16% 边框（`apps/web/src/components/ui/notificationSurface.ts:17-47`）。无 action/copy 时自动 compact 并隐藏 description。
- 线程错误：持久化 `lastError` → `timeout: 0`、`priority: "high"` 的 toast，稳定 id `thread-error:${threadId}` 原地更新，带 Copy（`apps/web/src/components/chat/useThreadErrorToast.ts`）。注释说明旧版 transcript 上方 banner 会推动布局，所以改成浮动 toast。
- 长期状态（provider 健康、限流）用聊天列 `role="alert"` banner；历史加载失败用空状态 + Try again；root error boundary 带可展开详情。
- 无通用 HTTP status → 文案映射；认证分类在 server adapter 按文本判断；文案无 i18n。
