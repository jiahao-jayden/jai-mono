# AnySearch 官方网络搜索 API 契约

核验日期：2026-09-03（Asia/Singapore）。本笔记固定以下官方仓库状态，避免后续 `main` 变化混入结论：AnySearch Skill `v3.1.1`，commit [`15b7ea5039983c9dee328be8c7c609f3eb86058e`](https://github.com/anysearch-ai/anysearch-skill/commit/15b7ea5039983c9dee328be8c7c609f3eb86058e)；AnySearch MCP Server `main`，commit [`f4ca4d4941e4c122be6522c1afc76012f1669654`](https://github.com/anysearch-ai/anysearch-mcp-server/commit/f4ca4d4941e4c122be6522c1afc76012f1669654)；AnySearch DSH 官方 TypeScript client，commit [`3ccdef05e2b502509415b023e206a4c9f6afb038`](https://github.com/anysearch-team/anysearch-dsh/commit/3ccdef05e2b502509415b023e206a4c9f6afb038)。官方文档入口为 [`anysearch.com/docs`](https://www.anysearch.com/docs)。

核验边界：本次只使用 AnySearch 官网、AnySearch 官方 GitHub 组织的仓库与固定 commit 下的源码/文档。尝试从本机直连 live endpoint 时，环境代理指向不可用的 `127.0.0.1:7890`，因此没有把本机网络失败当作 AnySearch 服务响应，也没有把未经运行时验证的 status code 或限流数值写成事实。

## 结论

1. **AnySearch 同时提供直接 HTTP JSON API 和远程 MCP；官方资料不是“只有 MCP”。** 直接 HTTP 的公共 origin 是 `https://api.anysearch.com`，官方 client 调用 `/v1/search`、`/v1/extract`、`/v1/domains` 和 `/v1/sub-domains`；MCP 的生产 endpoint 是 `https://api.anysearch.com/mcp`，传输方式是 Streamable HTTP。[官方 DSH client](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [官方 Skill 接口规范](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/shared/doc_spec.md) · [官方 MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md)
2. **HTTP API 的认证是可选 Bearer key。** 配置 key 时请求带 `Authorization: Bearer <API_KEY>`；不带 key 仍可匿名访问，但官方明确说匿名访问有更低的 rate limit/quota。官方 HTTP client 每次操作解析一次 key；没有 key 时省略 Authorization，而不是发送空值。[官方 Skill `SKILL.md`](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/SKILL.md) · [官方 DSH client 的认证与 header](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts)
3. **HTTP 搜索请求的当前 canonical 字段是 `query`、`max_results`、`tag`、`params`、`zone`、`language`。** 其中 `query` 必填；官方 typed client 将 `maxResults`、`tag`、`params`、`zone`、`language` 映射成这五个 snake_case JSON 字段。Skill CLI 的 `domain`、`sub_domain`、`sub_domain_params` 是兼容/能力发现入口，CLI 会将它们归一化为 `tag` 和 `params`；不能直接把这些兼容字段当成 HTTP client 当前必发字段。[官方 DSH `types.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/types.ts) · [官方 DSH `client.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [官方 Skill Node CLI 的 normalize 逻辑](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/anysearch_cli.js)
4. **官方 MCP 工具暴露的是另一层工具契约。** MCP 的 `search` schema 使用 `query`、`domain`、`sub_domain`、`sub_domain_params`、`max_results`；`get_sub_domains` 先发现垂直域和参数；`batch_search` 接收 1–5 个 query object；`extract` 接收 URL。MCP host 不需要自己拼 REST path，但若要做直接 HTTP 集成，应采用官方 HTTP client 所示的 canonical body，而不是照抄 MCP tool schema。[官方 MCP README 的 Available Tools](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md) · [官方 Skill 接口规范](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/shared/doc_spec.md)
5. **官方 HTTP client 期待统一 envelope：顶层 `code`、`message`、可选 `request_id`/`error_code`、以及 `data`。** HTTP 非 2xx、或 HTTP 成功但 JSON `code != 0`，都被官方 client 当作 provider failure；client 只把白名单诊断字段带入自己的错误对象，不把整个 SDK/响应对象跨边界透传。[官方 DSH `client.ts` 的 envelope 和错误解析](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [官方 Skill CLI 的 HTTP 错误处理](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/anysearch_cli.js)
6. **官方公开材料没有找到一份完整、独立的 OpenAPI/Swagger 规范或完整 HTTP status/error 表。** 因而下面的 HTTP 契约是用官方 Skill 文档和官方 DSH typed client 交叉重建的；字段/结构有源码验证的地方可以使用，HTTP status 的逐项语义、服务端限流算法和计费规则不能从这些材料外推。[官方文档入口](https://www.anysearch.com/docs) · [官方 Skill 仓库](https://github.com/anysearch-ai/anysearch-skill/tree/15b7ea5039983c9dee328be8c7c609f3eb86058e) · [官方 DSH 仓库](https://github.com/anysearch-team/anysearch-dsh/tree/3ccdef05e2b502509415b023e206a4c9f6afb038)

## HTTP Endpoint 速查

| Endpoint | 方法 | 请求 | 官方 client 的成功 `data` 形状 | 证据 |
| --- | --- | --- | --- | --- |
| `/v1/search` | `POST` | JSON body，见下文 | `results[]` + `metadata` | [client](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [types](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/types.ts) |
| `/v1/extract` | `POST` | `{ "url": "https://..." }` | `url` + `title` + `content` | [client](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [types](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/types.ts) |
| `/v1/domains` | `GET` | 无 body | `domains[]`，每项含 `domain`、`description`、`sub_domain_count` | [client](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [types](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/types.ts) |
| `/v1/sub-domains` | `GET` | 可重复的 `domain` query 参数 | `domains[]`，每项含 `sub_domains[]` 和参数定义 | [client](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [Skill doc spec](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/shared/doc_spec.md) |
| `/v1/auth/email/register` | `POST` | `{ "email": "..." }` | 注册 envelope，成功时包含一次性 plaintext API key | [MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md) |

`/v1/auth/email/register` 是 key 注册辅助接口，不是搜索请求本身。官方文档示例显示成功 `code: 0`、`message: "success"`，以及 `data.api_key`；示例中的 `rate_limit: 100`、`quota_limit: 0` 是返回示例，不足以证明所有账号/计划的固定额度。[官方 MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md)

## 认证与请求 Header

### 必要/可选 Header

| Header | 是否必需 | HTTP client 行为 | 说明 |
| --- | --- | --- | --- |
| `Content-Type: application/json` | POST 时应带 | Skill CLI 总是带；DSH client 在有 body 时带 | JSON body 的媒体类型。[Skill Node CLI](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/anysearch_cli.js) · [DSH client](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) |
| `Accept: application/json` | 文档未标为必需 | DSH client 带；Skill CLI 不显式带 | 官方 typed client 的偏好，不应误写成服务端硬性要求。[DSH client](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) |
| `Authorization: Bearer <API_KEY>` | 否 | 有有效 key 时带；匿名时省略 | key 用于更高额度/限流上限。[MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md) · [DSH client](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) |
| `X-Anysearch-Client` | 官方客户端会带 | Skill 为 `skill/3.1.1`；DSH 为 `dsh/0.1.4` | 客户端标识/流量归因 header；文档示例中的 MCP 值为 `mcp/1.0.0`。[Skill CLI constants](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/shared/constants.json) · [DSH version](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/version.ts) · [MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md) |

官方资料没有明确声明 `X-Anysearch-Client` 是服务端必需 header；实现时可以发送稳定的客户端标识，但不能把它当成认证或能力协商字段。[官方 Skill CLI](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/anysearch_cli.js) · [官方 DSH client](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts)

### Key 来源优先级

AnySearch Skill 文档给出的优先级是：CLI `--api_key` / Authorization header，高于环境变量 `ANYSEARCH_API_KEY`，高于 `.env`，最后是匿名访问；MCP host 负责将 key 作为自定义 Authorization header 注入。这个优先级属于官方客户端/接入文档行为，不应当误认为服务端会读取 `.env`。[官方 Skill `SKILL.md`](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/SKILL.md) · [官方 MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md)

## `POST /v1/search`

### Canonical HTTP request

官方 DSH typed client 实际发送的 JSON 结构如下：

```json
{
  "query": "quantum computing",
  "max_results": 5,
  "tag": "finance.quote",
  "params": {
    "symbol": "AAPL",
    "type": "stock"
  },
  "zone": "intl",
  "language": "en"
}
```

实际发送时只包含调用方提供的可选字段；`query` 总是发送。`params` 的 scalar value 在官方 DSH 类型中是 `string | number | boolean`，不是任意嵌套 JSON；`zone` 的 typed client 约束为 `cn | intl`；`language` 是字符串。[官方 DSH `client.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [官方 DSH `types.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/types.ts)

| 字段 | HTTP 名称 | 必需 | 官方验证到的类型/范围 | 备注 |
| --- | --- | --- | --- | --- |
| 查询 | `query` | 是 | non-empty string（官方 DSH advanced tool 在本地 trim/检查） | 一个调用对应一个意图；MCP README 也要求 ONE intent per call。[Skill](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/SKILL.md) · [DSH search tool](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/tools/search.ts) |
| 结果数量 | `max_results` | 否 | 官方 HTTP/Skill 文档：整数 `1–10`，默认 `10` | Skill v3.1.1 已将 CLI 侧钳制为 `1–10`。[MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md) · [Skill doc spec](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/shared/doc_spec.md) · [Skill CLI](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/anysearch_cli.js) |
| 垂直标签 | `tag` | 否 | string | 当前官方 HTTP client 的 canonical vertical selector。[DSH client](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) |
| 标签参数 | `params` | 否 | object；值为 string/number/boolean | 参数名和是否必填由能力目录返回，不应猜测。[DSH types](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/types.ts) · [Skill doc spec](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/shared/doc_spec.md) |
| 区域 | `zone` | 否 | `cn` 或 `intl` | Provider region hint。[DSH types](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/types.ts) |
| 语言 | `language` | 否 | string | Provider language hint。[DSH types](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/types.ts) |

### MCP/CLI 字段与 HTTP 字段的映射

| MCP/CLI 表达 | HTTP body | 当前证据 |
| --- | --- | --- |
| `domain` + `sub_domain` | `tag`，通常为完整 sub-domain，例如 `finance.quote` | 官方 Skill CLI 在发送前使用 `tag = tag || sub_domain`；同时检查 `domain` 是 tag 前缀。[Skill Node CLI](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/anysearch_cli.js) |
| `sub_domain_params` | `params` | CLI 将 `sub_domain_params` 解析为 params；官方 DSH client 只发送 `params`。[Skill Python CLI](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/anysearch_cli.py) · [DSH client](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) |
| MCP `search.max_results` | `max_results` | 同名字段；官方 MCP README 与 HTTP client 文档均写 1–10。[MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md) |

官方 DSH advanced tool 本地 schema 接受 `maxResults` `1–20`，但它随后调用 HTTP client 时没有将该值钳制为 10；这只能说明 DSH tool schema 与公开 HTTP/Skill 文档存在不一致，**不能证明 AnySearch HTTP 服务接受 11–20**。若要遵守已公开 API 契约，客户端应使用 `1–10`。[DSH advanced tool](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/tools/search.ts) · [DSH HTTP client](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [Skill v3.1.1 change history](https://github.com/anysearch-ai/anysearch-skill/commits/main/)

### Search success response

官方 DSH client 将成功响应验证为：

```json
{
  "code": 0,
  "message": "success",
  "request_id": "req_...",
  "data": {
    "results": [
      {
        "title": "Result title",
        "url": "https://example.com/page",
        "snippet": "Short result summary",
        "content": "Optional cleaned content"
      }
    ],
    "metadata": {
      "total_results": 1,
      "search_time_ms": 123
    }
  }
}
```

`request_id` 是可选顶层诊断字段；每个 result 的 `title`、`url` 必须是字符串，`snippet` 和 `content` 可选字符串；`metadata.total_results` 与 `metadata.search_time_ms` 必须是非负整数。官方 client 还会累计截断 canonical search response 中的 `content`，上限为 200,000 字符；这是 DSH client 的内存/投影边界，不是已确认的服务端响应上限。[官方 DSH `types.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/types.ts) · [官方 DSH `client.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [官方 DSH `limits.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/limits.ts)

官方 Skill CLI 的 Markdown 输出会优先显示 `content`，没有时显示 `snippet`；这只是 CLI projection，不改变 HTTP JSON 字段。[Skill Python CLI](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/anysearch_cli.py) · [Skill Node CLI](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/anysearch_cli.js)

## 能力目录 API

### `GET /v1/domains`

官方 typed client 期待 `data.domains` 为数组，每项包含：

```json
{
  "domain": "finance",
  "description": "...",
  "sub_domain_count": 3
}
```

该接口用于列出顶层 domain；它不提供具体参数 schema。具体参数要通过 `/v1/sub-domains` 读取。[官方 DSH `client.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [官方 DSH `types.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/types.ts)

Skill v3.1.1 的静态常量列出当前已知 top-level domains：`general`、`resource`、`social_media`、`finance`、`academic`、`legal`、`health`、`business`、`security`、`ip`、`code`、`energy`、`environment`、`agriculture`、`travel`、`film`、`gaming`。由于 DSH client 把 `/v1/domains` 称为 dynamic capability catalog，客户端不应只依赖这份静态列表；运行时应以接口返回为准。[Skill constants](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/shared/constants.json) · [DSH client](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts)

### `GET /v1/sub-domains`

官方 client 对输入 domain 逐个追加 query 参数，因此多个 domain 的请求形式是：

```text
GET /v1/sub-domains?domain=finance&domain=academic
```

官方 Skill/MCP 文档约束一次最多查询 5 个 domain；垂直搜索前应先调用能力目录，并严格使用返回的 sub-domain 与 required params。[官方 DSH `client.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [官方 MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md) · [官方 Skill doc spec](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/shared/doc_spec.md)

成功 `data.domains` 的结构为：

```json
{
  "domain": "finance",
  "description": "...",
  "sub_domains": [
    {
      "sub_domain": "finance.quote",
      "description": "...",
      "params": {
        "symbol": {
          "description": "...",
          "required": true,
          "sort_order": 1
        }
      }
    }
  ]
}
```

`sort_order` 在官方 typed client 中是可选整数；`description` 和 `required` 是每个参数定义的必需字段。客户端不应自行发明 tag 或 params；应以该目录的返回值为准。[官方 DSH `client.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [官方 Skill `SKILL.md`](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/SKILL.md)

## `POST /v1/extract`：Fetch / URL 内容提取

### 是否提供 fetch/extract API

**提供。** 直接 HTTP endpoint 是 `POST https://api.anysearch.com/v1/extract`，请求 body 只有必填 `url`；官方 DSH client 将它封装为 `extract({ url })`，并在响应中读取最终 `url`、`title`、`content`。[官方 DSH `client.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [官方 DSH `types.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/types.ts) · [官方 Skill doc spec](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/shared/doc_spec.md)

官方 Skill v3.1.1 对 Extract 文档写明：支持 HTML/XHTML、plain text、JSON、Markdown；不支持 PDF、DOC/DOCX、图片、音视频、archive、streaming media、playlist 等 binary/media；HTML/plain-text 输出可能截断到 50,000 字符，过大的 JSON/Markdown 返回错误。MCP Server README 的简短表格只写“HTML pages only”，与 Skill 的更细说明不完全一致；因此实现时应把支持范围视为**官方接入材料之间存在版本/文档差异**，不要未经 live probe 把每种媒体类型都当作保证能力。[官方 Skill `SKILL.md`](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/SKILL.md) · [官方 MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md)

### Extract success response

当前官方 DSH typed client 验证的最小成功 shape 是：

```json
{
  "code": 0,
  "message": "success",
  "request_id": "req_...",
  "data": {
    "url": "https://example.com/final",
    "title": "Page title",
    "content": "Cleaned page content"
  }
}
```

该 typed client **没有**把 `status`、`truncated`、`content_trust` 或原始媒体类型作为 `AnySearchExtractResponse` 的字段；AnySearch DSH 仓库中的部分中文接入说明声称这些字段会保留，但与同一 commit 的 `src/types.ts`/`src/client.ts` 不一致，应以 typed client 实现为当前可验证契约，其他字段降级为“未由当前官方 client 验证”。[官方 DSH `types.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/types.ts) · [官方 DSH `client.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [存在冲突的接入说明](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/docs/integration-options.zh-CN.md)

## 错误、限流与取消

### HTTP 与业务错误

官方 Skill CLI 和 DSH client 都执行联合判断：HTTP status 非 2xx 失败；即使 HTTP status 成功，只要 JSON envelope 的 `code` 存在且不等于 `0`，也失败。错误消息来自 `message`，如果存在则保留 `request_id`；DSH client 另外读取顶层 `error_code`。[官方 Skill Node CLI](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/anysearch_cli.js) · [官方 DSH `client.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts)

官方 DSH client 通过 `Retry-After` response header 读取 retry hint，并将其保留为诊断字段；该 client 明确“不自动 retry”。因此调用方应把 `Retry-After` 当作可选提示，而不是假定所有 429 都有该 header；也不应把 5xx/429 自动重试策略当成 AnySearch API 契约的一部分。[官方 DSH `client.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts)

### 限流和 quota

能确认的只有：匿名和带 key 都支持搜索，匿名的 rate limit/quota 更低，带 key 可获得更高限制；官方没有在当前公开材料中给出可泛化的搜索 endpoint 固定 RPM、每日 quota、按 endpoint 计费、429 JSON schema 或 key plan 矩阵。MCP README 的注册成功示例包含 `rate_limit: 100`，但它是单次示例响应，不能作为通用 plan 上限。[官方 MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md) · [官方 Skill `SKILL.md`](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/SKILL.md)

### 超时和取消

AnySearch HTTP 服务端的 timeout 契约没有在公开 API 文档中钉死。官方 DSH client 设置 55 秒 HTTP deadline；三个高级工具使用 60 秒工具预算；HTTP client 将调用方的 `AbortSignal` 与内部 timeout 合并，并且明确不自动 retry。这些是 DSH adapter 的客户端边界，不是 AnySearch 服务端 SLA。[官方 DSH `limits.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/limits.ts) · [官方 DSH `client.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts)

## MCP 契约：它是不是官方真正支持的入口

**是官方支持的入口，但它是 MCP 协议层，不是 HTTP REST body 的替代命名。** AnySearch 官方 MCP Server README 将生产 endpoint 固定为 `https://api.anysearch.com/mcp`，声明使用 Streamable HTTP，并列出 `search`、`get_sub_domains`、`batch_search`、`extract` 四个工具。MCP host 负责初始化/工具发现/调用；调用方不直接请求 `/v1/search`。[官方 MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md)

MCP 工具 schema 的名字是面向 Agent 的：`search` 使用 `domain`、`sub_domain`、`sub_domain_params`，`batch_search` 使用 `queries[]`；官方 Skill 文档把同一能力描述为 CLI 命令。官方 Skill v3.1.1 已将 CLI 迁移为 direct HTTP，但仍保留这些兼容/Agent-facing 名称，再由 CLI 归一化到 REST canonical fields。[官方 Skill `SKILL.md`](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/SKILL.md) · [官方 Skill CLI](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/anysearch_cli.js) · [官方 MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md)

当前官方 MCP README 没有给出完整 JSON-RPC 初始化报文、`tools/list` 的原始返回、MCP session header、MCP error envelope 或每个工具的完整 output schema；它只给出 endpoint、transport、客户端配置和高层工具参数表。因此如果目标是实现 JAI 的 HTTP provider，应直接按 `/v1/*` typed client；如果目标是复用 AnySearch 的完整 Agent-facing 工具集，应接 MCP 并以运行时 `tools/list` schema 为准。[官方 MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md) · [官方 DSH typed client](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts)

## 官方源码/SDK 发现结果

| 资产 | 版本/commit | 能证明什么 | 不能证明什么 |
| --- | --- | --- | --- |
| `anysearch-skill` | `v3.1.1`, `15b7ea5` | direct HTTP 的 CLI 请求路径、headers、请求字段、CLI 兼容映射、Extract 文档 | 服务端完整 OpenAPI、所有 status code、服务端限流实现 |
| `anysearch-mcp-server` | `main`, `f4ca4d4` | MCP production endpoint、Streamable HTTP、Agent-facing 工具名称和高层参数 | 完整 MCP wire transcript、原始 tool output schema、REST endpoint 的所有响应字段 |
| `anysearch-dsh` | `0.1.4`, `3ccdef0` | 官方 TypeScript HTTP client 的实际 paths、headers、envelope 验证、typed response shape、timeout/abort/Retry-After handling | AnySearch 服务端必须接受的最大结果数、服务端媒体支持全表、服务端 SLA |

对应源码：[`anysearch-skill`](https://github.com/anysearch-ai/anysearch-skill/tree/15b7ea5039983c9dee328be8c7c609f3eb86058e) · [`anysearch-mcp-server`](https://github.com/anysearch-ai/anysearch-mcp-server/tree/f4ca4d4941e4c122be6522c1afc76012f1669654) · [`anysearch-dsh`](https://github.com/anysearch-team/anysearch-dsh/tree/3ccdef05e2b502509415b023e206a4c9f6afb038)

## 对本项目的影响

1. 若 JAI 需要一个可控的 HTTP provider，首版应实现 `POST /v1/search` 和可选 `POST /v1/extract`，使用结构化 DTO：搜索 result 只接受 `title`、绝对 `url`、可选 `snippet`/`content`；响应 envelope 只投影 `code`、`message`、`request_id`、`error_code` 和经过白名单验证的 `data`。这与官方 DSH typed client 的边界一致。[官方 DSH `client.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts) · [官方 DSH `types.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/types.ts)
2. HTTP provider 应把 `max_results` 限制为公开文档的 `1–10`，不要照搬 DSH advanced tool 暂时存在的 `1–20` 本地 schema。需要垂直搜索时先请求 `/v1/domains`/`/v1/sub-domains`，再把目录返回的 `sub_domain` 映射成 `tag`，把参数映射成 `params`。[官方 Skill doc spec](https://github.com/anysearch-ai/anysearch-skill/blob/15b7ea5039983c9dee328be8c7c609f3eb86058e/scripts/shared/doc_spec.md) · [官方 DSH `src/tools/search.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/tools/search.ts) · [官方 DSH `src/client.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts)
3. `Authorization` key 应由运行时凭据系统注入，不进入 durable config、日志或 UI projection；无 key 时可匿名请求。调用方应识别 HTTP 非 2xx 与 `code != 0` 两种失败，并保留 `request_id`、`error_code`、`Retry-After` 等白名单诊断字段。[官方 MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md) · [官方 DSH `client.ts`](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/src/client.ts)
4. 不应为了 HTTP provider 引入 MCP JSON-RPC wrapper，也不应把 MCP 的 `domain/sub_domain` schema 直接暴露成 REST adapter 的事实模型。MCP 是另一个官方接入面；若未来需要完整 Agent-facing 工具发现和服务端 batch，再单独实现 MCP transport。[官方 MCP README](https://github.com/anysearch-ai/anysearch-mcp-server/blob/f4ca4d4941e4c122be6522c1afc76012f1669654/README.md) · [官方 DSH integration comparison](https://github.com/anysearch-team/anysearch-dsh/blob/3ccdef05e2b502509415b023e206a4c9f6afb038/docs/integration-options.zh-CN.md)

尚未确认的服务端事实：实时 live response、真实 429/401/5xx body、HTTP endpoint 的固定限流/配额、`format` 字段是否仍被服务端接受、Extract 对 JSON/Markdown/纯文本的实际内容上限、以及 MCP 原始 `tools/list`/错误帧。这些需要可用的 live 网络或 AnySearch 提供的完整 OpenAPI/MCP transcript；当前不应作为已验证契约实现。

