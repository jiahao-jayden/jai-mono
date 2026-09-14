# 接入飞书 Connector：OpenConnector 上游调研

> 调研日期：2026-08-10（Asia/Singapore）
> 上游固定版本：[`e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1`](https://github.com/oomol-lab/open-connector/commit/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1)。这是本仓库已记录于 [`app/connector/OPENCONNECTOR-SNAPSHOT.md`](../../../app/connector/OPENCONNECTOR-SNAPSHOT.md) 的来源版本，而不是浮动的 `main`。

## 结论

**不要把 OpenConnector 整个运行时抄进 Jai，也不要把 396 个飞书 Action 整包开放给 Agent。** 应在现有 `app/connector` 中新增一个 `feishu` adapter，首版只移植用户 OAuth 的 7 个只读 Action：`get_current_user`、`get_document`、`get_document_content`、`list_document_blocks`、`list_bitable_tables`、`list_bitable_fields`、`search_bitable_records`。它们只需要 `offline_access`、`docx:document:readonly`、`bitable:app:readonly` 三个 scope；上游的根 Action 定义和 scope 常量在[这里](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/actions.ts#L74-L200)和[这里](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/scopes.ts#L15-L19)。

这不是功能削减的临时做法，而是飞书 OAuth 的必要边界：上游 `feishu` 会把所有 Action 的 `providerPermissions` 去重后加入授权 scope；全量数组在该快照实际展开为 **396 个 Action、163 个权限**，覆盖 IM、Base、日历、任务、云文档、云盘、表格、审批、邮箱、会议、OKR 等写操作和高敏感数据。[定义中的 scope 聚合](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/definition.ts#L6-L36)与[完整模块拼接](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/actions.ts#L201-L241)说明了这个授权面。全量抄入会同时扩大应用审核、用户 consent 和 Agent 误操作的范围。

**当前 OAuth Gateway 不能直接接飞书。** 它把所有 token/refresh 请求固定编码为 `application/x-www-form-urlencoded`，[实现见 `requestToken`](../../../app/oauth-gateway/src/app.ts:171)；上游飞书 provider 和飞书官方 v2 文档都要求 `client_secret_post` 的 **JSON** body（`application/json; charset=utf-8`）。[上游配置](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/definition.ts#L24-L33)，[飞书官方 token 文档](https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token)。因此在注册 service 前，必须给 Gateway 的 service 定义增加显式的 `tokenRequestFormat: "json"`（并同时用于 refresh）；不能用 switch/特例悄悄把飞书塞进现有 form-only 请求器。

还有一个必须一并修正的上游缺陷：上游使用的 `/authen/v2/oauth/token` 已被飞书标记为历史版本，官方要求迁到 `https://accounts.feishu.cn/oauth/v3/token`，并说明 v3 对 PKCE 的校验更严格；其余请求/响应结构保持一致。[飞书官方迁移说明](https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token)。现有 Gateway 已始终发送 `code_challenge` 和 `code_verifier`，[发起与交换代码](../../../app/oauth-gateway/src/app.ts:33)，与 v3 的 PKCE 要求相容；但 JSON body 和 v3 token endpoint 都必须在新服务定义中落地。

## 上游是什么

上游并非一个单独的“飞书 connector manifest”。每个 provider 以 `src/providers/<service>/definition.ts` 为定义入口，构建脚本据此发现 provider 并生成 executor registry。[provider 发现逻辑](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/scripts/provider-source.ts#L13-L47)，[registry 生成逻辑](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/scripts/generate-provider-registry.ts#L30-L50)。该快照有三种互不等价的飞书实现：

| 上游 service | 凭证与主体 | 合适的产品场景 | 范围来源 |
| --- | --- | --- | --- |
| `feishu` | 用户 OAuth `user_access_token` | 用户连接并操作其可访问的飞书资源 | [definition](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/definition.ts#L12-L33) |
| `feishu_app_bot` | `appId` + `appSecret` 换取 tenant token | 管理员配置企业自建应用/bot 自动化 | [definition](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu_app_bot/definition.ts#L5-L42) |
| `feishu_custom_bot` | 群机器人 webhook token/URL，可选签名 secret | 单向群通知 | [definition](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu_custom_bot/definition.ts#L5-L38) |

本次若目标是“用户在 Jai 中连接自己的飞书”，应选第一行 `feishu`。`feishu_app_bot` 是 tenant 身份，且 tenant token 只在进程内按过期时间缓存；它不是用户 OAuth 的替代。[tenant token 取得与缓存](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu_app_bot/executors.ts#L199-L266)。`feishu_custom_bot` 只有五个发送型 Action，不能读取 Docs/Bitable。[Action 定义](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu_custom_bot/actions.ts#L45-L98)。

从 `e298…` 到 2026-08-09 的上游 `6d587010287e2f4ad0680e954bba4dd5dbd3bb0f` 的 GitHub compare 中，`src/providers/feishu/**` 没有文件变更；因此以上 provider inventory 对当前上游仍成立。[compare](https://github.com/oomol-lab/open-connector/compare/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1...6d587010287e2f4ad0680e954bba4dd5dbd3bb0f)

## 认证、回调与凭证生命周期

上游 `feishu` 走授权码 OAuth：authorize endpoint 是 `https://accounts.feishu.cn/open-apis/authen/v1/authorize`；固定快照的 token endpoint 是已废弃的 `https://open.feishu.cn/open-apis/authen/v2/oauth/token`；请求体为 JSON，认证方式为 client secret in POST body。[上游 definition](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/definition.ts#L24-L33)，[飞书官方 v2 参数、响应与 v3 迁移说明](https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token)。飞书要求 authorization code 在 5 分钟内且只能使用一次；`offline_access` 才会让响应包含 refresh token；token 和 refresh token 的实际有效期应从响应读取而不是硬编码。[同一官方文档](https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token)。

上游通用 runtime 发起时生成随机 `state`，可选 PKCE verifier，默认在 15 分钟后失效；回调消费 state 后交换 code，并把 OAuth credential 交给 connection service 保存。[OAuth flow](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/oauth/oauth-flow-service.ts#L62-L185)。其回调地址是统一的 `${publicOrigin}/oauth/callback`，不是 `/oauth/callback/feishu`。[callback 构造](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/oauth/oauth-client-config-service.ts#L141-L144)，[callback 路由](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/server/connect-server.ts#L203-L210)。

Jai 的形态不同但可复用这个安全模型：Gateway redirect URI 应配置为公网 HTTPS 的 `gatewayCallbackUrl`，Gateway 再把 `state` 和 `code` 转发到 desktop 的 `applicationCallbackUrl`；现有实现已经这样工作。[Gateway authorize/callback](../../../app/oauth-gateway/src/app.ts:33)。Desktop 的 `OAuthFlowManager` 在主进程内保存一次性 state、绑定 service、保存 PKCE verifier；Desktop 当前将 flow TTL 配置为两分钟。[实现](../../../app/desktop/electron/oauth.ts:8)。注册飞书自建应用时，飞书控制台里的回调白名单必须填写 **Gateway URL**，不是 `jai:` scheme 或 loopback application callback。

上游以 `/authen/v1/user_info` 校验 `user_access_token`，将 `open_id` 作为 account ID，并保存 `union_id`、`tenant_key` 元数据。[credential validator](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/executors.ts#L131-L151)，[HTTP client 与 envelope 校验](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/runtime.ts#L180-L241)。Action request 使用 `Authorization: Bearer <user_access_token>`，并把飞书“HTTP 200 但 `code != 0`”作为失败处理；认证错误映射为 401、scope 错误映射为 403。[同一 HTTP client](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/runtime.ts#L198-L282)。这些语义应原样保留，错误对象则转换为 Jai 的 `Result<T, TaggedError>`。

OpenConnector 的 Node runtime 将 connection credential、OAuth client config 和 pending OAuth state 存到 SQLite；是否 AES-256-GCM 加密取决于 `OOMOL_CONNECT_ENCRYPTION_KEY`，缺失时它明确警告存储未加密。[SQLite store](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/server/storage/sqlite-runtime-store.ts)，[secret codec](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/server/secrets/secret-codec.ts)，[startup warning](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/server/index.ts#L100-L111)。Jai 已明确选择由用户全局 connector settings 持久化凭证，[`ConnectorConfiguration.credentials`](../../../app/connector/src/types.ts:89) 也是当前运行时合同；飞书适配应沿用这个边界，不引入另一套存储机制。无论底层存储方案如何，token 不得进入 renderer、Agent prompt、RPC DTO、日志或工具输入；将凭证迁至 OS keychain 是独立的架构决策，不是本次适配的前置条件。

## 应移植的 API 与依赖边界

首版只需移植上游的 `definition.ts` 中对应定义、`actions.ts` 前 7 个 Action、`runtime.ts` 中这 7 个 handler、`scopes.ts`，并实现 Jai adapter 的 `execute` 入口；各 Action 的 URL 分别是 `/authen/v1/user_info`、Docx document/read content/blocks 和 Bitable tables/fields/records search。[Action schema](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/actions.ts#L78-L200)，[HTTP endpoint mapping](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/runtime.ts#L35-L190)。这能直接契合本仓库 `ConnectorAdapter` 的 action/schema/`Result` 合约。[Jai adapter 接口](../../../app/connector/src/types.ts:46)

不要移植上游的 `ConnectServer`、Hono 路由、MCP server、SQLite runtime、catalog 生成器或 web console。Jai 已有一个进程内的 `MemoryConnectorService` 和已发布的 action-discovery/approval 协议；默认注册表目前只含 Context7、AMap、McDonald's China、Google、GitHub。[Jai registry](../../../app/connector/src/adapters/index.ts:57) 上游的一整套 server 是重复实现，且其原生 `Error` 流并不满足本仓库的 `TaggedError`/`better-result` 边界规则。

上游 full provider 的 executor 还依赖 `shared/**` 的 29 个 domain handler 组、provider runtime、transit file service 和 guarded fetch；不使用飞书官方 SDK，主要依赖标准 `fetch`、`FormData`、`File`、`node:crypto` 和上游内部基础设施。[executor wiring](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/executors.ts#L46-L128)，[共享文件目录](https://github.com/oomol-lab/open-connector/tree/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/shared)，[依赖清单](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/package.json#L1-L72)。上游完整 Node runtime 要 Node 22+，CI 则说明原生 TypeScript type stripping 需要 Node >=22.18 或 >=23.6，并固定 Node 24。[README](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/README.md#L268-L282)，[CI](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/.github/workflows/ci.yml#L23-L27)。这些 Node server 要求不适用于把纯 HTTP adapter 移植进 Electron main process。

## 明确的集成风险

1. **全量 scope 与操作策略。** 396 Action 不应以一个 connector 的“always allow”暴露；首版全只读，之后每加入一个写 Action 都新增最小 scope、`sideEffect`/敏感度、approval 测试和飞书 sandbox 合约测试。上游的完整 Action 拼接没有替 Jai 做该策略决定。[上游完整拼接](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/actions.ts#L201-L241)，[Jai approval 执行点](../../../app/connector/src/runtime.ts:177)。
2. **刷新必须原子地替换 refresh token。** 飞书官方说明 refresh token 只能用一次；刷新后的 access/refresh token 必须作为一个密钥库事务一起写入，失败时不要覆盖旧凭据。[飞书 token 文档](https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token)，[上游 refresh service](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/oauth/oauth-credential-refresh-service.ts#L25-L75)。
3. **错误不是只看 HTTP status。** 上游专门处理飞书成功 HTTP status 内的业务错误；Jai adapter 也应先解析 envelope，再将 401/403/429/5xx 映射到允许列表的 connector `TaggedError`，不向 RPC/renderer 传 stack、cause 或 SDK 原始响应。[上游映射](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/runtime.ts#L215-L282)。
4. **没有入站 bot/event 能力。** 上游 `feishu` 目录没有事件回调、challenge、encrypt-key 解密或 websocket/long-connection consumer；`feishu_app_bot` 仅能查询已经发布的应用事件订阅。若目标是“飞书里给 bot 发消息即可唤醒 Agent”，这是另一个 event gateway 项目，不能声称来自本次 connector copy。[provider 目录](https://github.com/oomol-lab/open-connector/tree/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu)，[订阅查询 handler](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu_app_bot/executors.ts#L335-L365)。
5. **“Lark”不能从文案推导出来。** 上游 user OAuth 和 Open API host 写死为 `*.feishu.cn`，custom bot 也校验 `open.feishu.cn`；国际版 Lark 需按官方环境和 endpoint 单独验证，不能仅改 display name。[user OAuth definition](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu/definition.ts#L24-L35)，[custom bot host validation](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/feishu_custom_bot/executors.ts#L447-L486)。
6. **出网/SSRF 与文件。** 上游的所有 provider 请求经 guarded fetch，并将内网地址拒绝为 SSRF 防护；复制 HTTP 层时保留 host allowlist、`AbortSignal` 和跨域 redirect 去 credential，而不是裸 `fetch`。文件上传/download Action 还需要 transit-file 生命周期，进一步说明它们不属于首版范围。[upstream provider runtime](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/src/providers/provider-runtime.ts#L37-L67)，[Jai Action context 的 cancellation](../../../app/connector/src/types.ts:64)。

## 许可证和落实顺序

OpenConnector 是 Apache-2.0；分发改造后的移植代码必须带上许可证、保留归属/NOTICE，并在改动文件或 NOTICE 中说明修改。Apache-2.0 本身也不授予飞书商标使用权。[上游 LICENSE](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/LICENSE.txt#L1-L10)，[上游 NOTICE](https://github.com/oomol-lab/open-connector/blob/e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1/NOTICE.md#L1-L10)，[本仓库已有 attribution](../../../app/connector/NOTICE.open-connector.md)。

建议的实施顺序是：

1. 给 OAuth Gateway 的 provider schema 增加 token request format，并配置飞书 **v3** endpoint、JSON body、三个只读 scope、HTTPS Gateway callback。
2. 沿用用户全局 connector 配置保存 OAuth client token；完成 state/PKCE、回调、token exchange、refresh rotation 的集成测试，并确保 token 不越过主进程、RPC 和 Agent 边界。
3. 从上游固定快照移植 7 个只读 Action 到 `app/connector/src/adapters/feishu.ts`，保留 endpoint/envelope/pagination 语义，同时改用 `Result`、`TaggedError`、注入 fetcher 和 `AbortSignal`。
4. 接入默认 registry、OAuth application 定义、连接 summary，并用真实飞书测试租户覆盖 re-auth、缺 scope、token 失效、HTTP 200 + non-zero `code`、分页和 cancellation。
5. 只有在有具体用户工作流和审批 UX 后，才按 domain 逐批导入写 Action；每批重新审核 scope、side effect 和数据敏感性。
