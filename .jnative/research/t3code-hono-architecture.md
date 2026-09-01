# t3code 对 JAI 远程 Runtime 与 Hono 取舍的启示

核验日期:2026-09-01。源码固定到 [`pingdotgg/t3code` 的 `b883fc0`](https://github.com/pingdotgg/t3code/tree/b883fc066ea5c9bebbe1c3e9b4bc2471aab3685f)，避免仓库后续演进混入本次判断。

## 结论

1. t3code 将 Web、Electron Desktop、Mobile 与执行 Server 分开：客户端通过认证后的 RPC WebSocket 连接 Server；Agent、终端、Git 与文件读写只在 Server 发生。[架构说明](https://github.com/pingdotgg/t3code/blob/b883fc066ea5c9bebbe1c3e9b4bc2471aab3685f/docs/internals/overview.md#L5-L28)
2. Server 可脱离 Electron 启动：`npx t3` 启动本地后端与 Web App，`t3 serve` 支持无 GUI 运行。[README](https://github.com/pingdotgg/t3code/blob/b883fc066ea5c9bebbe1c3e9b4bc2471aab3685f/README.md#L24-L34) [远程访问](https://github.com/pingdotgg/t3code/blob/b883fc066ea5c9bebbe1c3e9b4bc2471aab3685f/docs/user/remote-access.md#L83-L107)
3. 它将连接、认证、RPC 与客户端状态收敛为非视觉客户端运行时，React 组件不直接构造 transport/RPC。这是 JAI 剥离 Electron 前端时值得复用的方向。[架构说明](https://github.com/pingdotgg/t3code/blob/b883fc066ea5c9bebbe1c3e9b4bc2471aab3685f/docs/internals/overview.md#L51-L59)
4. 远程能力来自可部署的 Server、配对/认证和 HTTPS/WSS，而不是 Hono。实时协议是认证后的 `GET /ws` Effect RPC，并按 RPC method 作 scope 授权。[远程访问](https://github.com/pingdotgg/t3code/blob/b883fc066ea5c9bebbe1c3e9b4bc2471aab3685f/docs/user/remote-access.md#L35-L127) [实现](https://github.com/pingdotgg/t3code/blob/b883fc066ea5c9bebbe1c3e9b4bc2471aab3685f/apps/server/src/ws.ts#L2511-L2590)
5. 事件编排、持久化事务、读模型投影和后台 worker 属于 Server 核心；HTTP 框架不替代这些职责。[架构说明](https://github.com/pingdotgg/t3code/blob/b883fc066ea5c9bebbe1c3e9b4bc2471aab3685f/docs/internals/overview.md#L61-L85)
6. t3code 未证明提供基础设施级 sandbox；其现有 sandbox 主要是各 Agent provider 的权限与运行时策略。[Provider 文档](https://github.com/pingdotgg/t3code/blob/b883fc066ea5c9bebbe1c3e9b4bc2471aab3685f/docs/internals/providers.md#L98-L116)
7. `apps/server` 没有 Hono 依赖，而是使用 Effect platform/RPC。这证明 Web + 远程 Runtime 并不要求采用 Hono，但不评价 Hono 作为 transport adapter 的可用性。[依赖清单](https://github.com/pingdotgg/t3code/blob/b883fc066ea5c9bebbe1c3e9b4bc2471aab3685f/apps/server/package.json#L17-L51)

## 对 JAI 的约束

- 演化目标是独立、可部署的 Runtime Host，加上共享客户端运行时；不是以 Hono 重写 Agent、Session journal、审批或 sandbox 生命周期。
- 未来若需要公开 HTTP/WebSocket，Hono 可以是 Runtime Host 的一个 transport adapter，但必须保留认证、逐方法授权、流、取消和安全错误 DTO。
- Sandbox 是独立执行环境。它不能被 HTTP request 生命周期持有，更不能把服务进程当前目录或用户桌面当成云端 workspace。
- 本文只作架构参照，不要求复制 t3code 的 Effect RPC 实现或其 provider 机制。
