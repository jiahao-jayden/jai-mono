# 术语

**Runtime Capability Source**:
Host 为一次 Operation 解析并装配 Coding Agent configuration、Skills、Agent Plugins 与受信任 Extensions 的产品边界。它不拥有 Session journal，也不把不同领域的持久化事实抽成一个泛化 storage。
_Avoid_: storage adapter, configuration database, extension registry

**Coding Agent file configuration**:
Coding Agent 在用户目录与 workspace 的 `.jai/settings.json`、`.jai/settings.local.json` 中读取的 JSON 配置；它与 Server 持有的 Provider/API-key 配置是不同的事实。
_Avoid_: Provider configuration, Runtime Agent settings

**Agent Plugin**:
带 `plugin.json` 的文件包，可贡献 Skills、MCP 等 Agent 能力；它与随 JAI 服务部署并被 Host 装配的 Extension 不是同一种机制。Desktop 可从受控本地目录发现它；Web 不动态发现或执行用户 Agent Plugin。
_Avoid_: Extension, Electron plugin, generic plugin
