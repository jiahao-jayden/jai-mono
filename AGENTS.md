# AGENTS.md — 项目规范

## Gateway (packages/gateway)

### CORS
- Hono 默认 `cors()` 的 `allowMethods` **不包含 PATCH**，只有 `GET, HEAD, PUT, POST, DELETE`
- 如需使用 PATCH 方法，必须显式配置：`cors({ allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] })`
- 当前方案：config update 路由同时注册 PATCH 和 POST，桌面前端使用 POST 避免 CORS preflight 被拒

### Config 路由
- `POST /config` / `PATCH /config` — 更新配置（部分更新）
- Gateway 负责标准化 model 格式：收到 `model: "provider/modelId"` 时自动同步 `provider` 字段；收到裸 `model` + 单独 `provider` 时自动拼接
- 前端不做 model/provider 格式拼接，信任 gateway 返回值

## Desktop App (app/desktop)

### 架构分层
- **Gateway 是配置的单一数据源**，前端只负责读取和展示
- 前端 `setModel` 乐观更新 UI 后调 gateway API，用 gateway 响应确认最终状态
- `syncModels` 从 `config.model` 直接匹配 `flattenModels` 生成的 ID 列表，不做多策略回退

### Electron
- `webSecurity` 保持默认 `true`，不要关闭
- 前端到 gateway 的 HTTP 请求受 CORS 约束，mutation 操作使用 POST/PUT/DELETE（Hono 默认允许），避免 PATCH

### Gateway Client (services/gateway)
- `ofetch` 用于 GET/PUT/DELETE 等常规请求
- config update 使用 POST 方法（不用 PATCH），确保 CORS 兼容
- 错误不要静默吞噬（`.catch(() => {})`），至少 `console.error`

### Settings 持久化
- 全局配置文件：`~/.jai/settings.json`
- `model` 字段格式始终为 `"provider/modelId"`（如 `"ice/gpt-5.4-xhigh"`）
- `provider` 字段与 `model` 中的 provider 前缀保持同步
