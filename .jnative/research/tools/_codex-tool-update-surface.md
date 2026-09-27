# Codex：MCP / 动态工具目录变化如何通知模型

- 核验日期：2026-09-27
- 钉住 SHA：`8f195c93d7e7acfef95acf273f0e49cce917e291`（`openai/codex` `main` @ 2026-09-27）
- 仓库：https://github.com/openai/codex
- 问题：MCP `notifications/tools/list_changed` 或首次 `tools/list` 之后，模型是通过下一请求的 `tools` 数组、`tool_search`/namespace，还是通过一条对话消息得知工具目录变化？

## 结论（可复核）

1. **`notifications/tools/list_changed` 本身不会刷新目录，也不会通知模型**——client 只打日志。
2. **首次目录进入进程内状态靠连接完成时的 `tools/list`**，结果写入 `ClientToolCatalog`；普通 MCP 默认是 Local 快照，不会因 notification 自动重拉。
3. **发给模型的 `tools` 数组来自 `Prompt.tools` ← `ToolRouter.model_visible_specs()`**，只包含 Direct exposure（含启用时的 `tool_search`），Deferred MCP 工具本体不进该数组。
4. **search tool 开启时 MCP 工具默认 Deferred**：模型靠 `tool_search` 按需加载 schema；namespace 摘要要么写进 `tool_search` 描述（feature 关），要么写进对话里的 world-state `<tools>` 片段（`DeferredToolWorldState` 开）。
5. **目录集合相对上一 snapshot 未变时不重发 tools world-state**；集合变了才发 Added/Removed 片段。
6. **首次 deferred namespaces 为空时不渲染、不持久化 tools world-state**。

## 逐步路径

### A. 输入：MCP server 连接完成（首次 `tools/list`）

| 步 | 状态变化 | 源码 |
|---|---|---|
| 1 | `initialize` 后调用 `list_tools_for_client_uncached`（RPC `tools/list`） | [mcp_rmcp_client.rs#L1013-L1064](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/codex-mcp/src/rmcp_client.rs#L1013-L1064) |
| 2 | 结果装进 `ManagedClient.tool_catalog = ClientToolCatalog::new(...)`；无 Apps live watch 时为 `CatalogSource::Local` | 同上 + [client_tool_catalog.rs#L59-L86](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/codex-mcp/src/client_tool_catalog.rs#L59-L86) |
| 3 | 采样前 `capture_step_context` → `mcp_runtime_for_step` → `current_binding_with_requirements` → `capture_binding_with_metadata` 读 catalog 做成 `McpBinding` | [session/mod.rs#L3894-L3925](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/session/mod.rs#L3894-L3925)、[runtime.rs#L416-L463](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/codex-mcp/src/runtime.rs#L416-L463)、[tool_catalog.rs#L252-L364](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/codex-mcp/src/connection_manager/tool_catalog.rs#L252-L364) |
| 4 | `built_tools` / `build_tool_router` → `append_mcp_tools`：search 开则 `Deferred`，否则 `Direct` | [spec_plan.rs#L153-L160](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/tools/spec_plan.rs#L153-L160)、[mcp_tool_exposure.rs#L85-L90](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/mcp_tool_exposure.rs#L85-L90) |
| 5 | `build_model_visible_specs` 只收 Direct；Deferred 不进数组；必要时注册 `tool_search` | [spec_plan.rs#L553-L566](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/tools/spec_plan.rs#L553-L566)、[spec_plan.rs#L377-L384](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/tools/spec_plan.rs#L377-L384) |
| 6 | `Prompt.tools = model_visible_specs()` 发给模型 | [turn.rs#L1562-L1572](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/session/turn.rs#L1562-L1572) |
| 7a | **Direct 模式**：MCP namespace/工具 schema 直接出现在下一请求 `tools` | 步 4–6 |
| 7b | **Deferred + `DeferredToolWorldState`**：`ToolsState` 把 namespace 摘要写成 developer world-state 片段（对话消息面） | [session/world_state.rs#L279-L287](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/session/world_state.rs#L279-L287)、[world_state/tools.rs#L96-L149](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools.rs#L96-L149) |
| 7c | **Deferred 且未开 world-state**：namespace/source 列表写进 `tool_search` 的 description（`ToolSearchSourceListing::Include`） | [spec_plan.rs#L1458-L1474](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/tools/spec_plan.rs#L1458-L1474)、[tool_search_spec.rs#L34-L95](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/tools/handlers/tool_search_spec.rs#L34-L95) |
| 8 | 模型要具体 tool schema 时调 `tool_search`；handler 返回 `LoadableToolSpec`（含 `mcp__*` namespace） | [tool_search.rs#L192-L239](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/tools/handlers/tool_search.rs#L192-L239) |

### B. 输入：MCP `notifications/tools/list_changed`

| 步 | 状态变化 | 源码 |
|---|---|---|
| 1 | `ElicitationClientService` 把 notification 转给 `LoggingClientHandler` | [elicitation_client_service.rs#L324-L333](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/rmcp-client/src/elicitation_client_service.rs#L324-L333) |
| 2 | `on_tool_list_changed` **只** `info!("MCP server tool list changed")`，无 invalidate / 无 `tools/list` | [logging_client_handler.rs#L86-L88](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/rmcp-client/src/logging_client_handler.rs#L86-L88) |
| 3 | Local catalog 不因 notification 前进；下一次 binding 仍读旧 snapshot，除非另有显式 refresh / runtime dirty 重建（配置、auth、Apps `refresh_codex_apps_tools` 等） | [client_tool_catalog.rs#L45-L51](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/codex-mcp/src/client_tool_catalog.rs#L45-L51)、[client_tool_catalog.rs#L148-L172](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/codex-mcp/src/client_tool_catalog.rs#L148-L172)；`mark_mcp_runtime_dirty` 路径见 [session/mcp.rs#L336-L338](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/session/mcp.rs#L336-L338) |
| 4 | **模型侧：此 notification 单独发生时无新 `tools`、无新 world-state、无 tool_search 推送** | 由步 2–3 推出；仓库内未找到 list_changed→模型 的第二路径 |

## 边界

### 1. 首次 `tools/list` 为空

主张：deferred namespaces 空且 previous 为 Absent/Unknown 时，`ToolsState::render_diff` 返回 `None`；集成测试确认请求里没有 tools world-state，rollout 也不持久化 `tools` 段。

摘录 — `tools.rs`：

```96:109:codex-rs/core/src/context/world_state/tools.rs
    fn render_diff(
        &self,
        previous: PreviousSectionState<'_, Self::Snapshot>,
    ) -> Option<Box<dyn ContextualUserFragment>> {
        let current = self.snapshot();
        if matches!(previous, PreviousSectionState::Known(previous) if previous == &current)
            || self.deferred_namespaces.is_empty()
                && matches!(
                    previous,
                    PreviousSectionState::Absent | PreviousSectionState::Unknown
                )
        {
            return None;
        }
```

Permalink: https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools.rs#L96-L109

摘录 — 集成测试 `initially_empty_deferred_tool_world_state_is_not_rendered_or_persisted`：

```1208:1236:codex-rs/core/tests/suite/mcp_tool_exposure.rs
async fn initially_empty_deferred_tool_world_state_is_not_rendered_or_persisted() -> Result<()> {
    // ...
    test.submit_turn("inspect empty deferred tools").await?;

    let request = response.single_request();
    assert!(tools_state_sections(&request).is_empty());
    // ...
    assert!(
        world_states
            .iter()
            .all(|state| state.get("tools").is_none())
    );
```

Permalink: https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/tests/suite/mcp_tool_exposure.rs#L1208-L1236

### 2. list_changed（或显式 refresh）但工具集合未变

主张 A：`list_changed` 处理函数无副作用，集合是否变化都不会因此重拉。

```86:88:codex-rs/rmcp-client/src/logging_client_handler.rs
    async fn on_tool_list_changed(&self, _context: NotificationContext<RoleClient>) {
        info!("MCP server tool list changed");
    }
```

Permalink: https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/rmcp-client/src/logging_client_handler.rs#L86-L88

主张 B：即便有一次会更新 catalog 的 refresh，若 deferred namespace snapshot 相等，world-state **不**再发；单元测试对 `Known(same)` 断言 `render_diff` 为 `None`；集成测试在 Apps refresh 后 follow-up 的 tools_state 与首次相同。

```118:124:codex-rs/core/src/context/world_state/tools_tests.rs
    assert!(
        tools
            .render_diff(PreviousSectionState::Known(&tools.snapshot()))
            .is_none()
    );
```

Permalink: https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools_tests.rs#L118-L124

```1146:1187:codex-rs/core/tests/suite/mcp_tool_exposure.rs
    // Publish a new catalog revision with the same metadata from the ready client.
    test.codex.refresh_codex_apps_tools().await?;
    test.submit_turn("inspect unchanged deferred tools").await?;
    // ...
    assert_eq!(tools_states[0], tools_states[1]);
```

Permalink: https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/tests/suite/mcp_tool_exposure.rs#L1146-L1187

## 引证摘录（主张 + SHA permalink + 原文）

### C1. list_changed 只日志

主张：MCP tool list changed notification 在 Codex client 侧不触发目录刷新。

https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/rmcp-client/src/logging_client_handler.rs#L86-L88

```rust
    async fn on_tool_list_changed(&self, _context: NotificationContext<RoleClient>) {
        info!("MCP server tool list changed");
    }
```

转发点：https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/rmcp-client/src/elicitation_client_service.rs#L320-L333

```rust
        <LoggingClientHandler as Service<RoleClient>>::handle_notification(
            // ...
        )
        // ...
        <LoggingClientHandler as Service<RoleClient>>::get_info(&self.handler)
```

（完整函数体见该文件 L320 起；handler 字段类型为 `LoggingClientHandler`，见 L61 / L123。）

### C2. 连接时 `tools/list` 写入 catalog

主张：startup 路径显式 uncached `tools/list`，结果构造 `ClientToolCatalog`。

https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/codex-mcp/src/rmcp_client.rs#L1013-L1064

```rust
    let list_start = Instant::now();
    // ...
    let tools = list_tools_for_client_uncached(
        &server_name,
        is_codex_apps_mcp_server,
        /*codex_apps_refresh_trigger*/ "initial",
        &client,
        startup_timeout,
        catalog_item_limit,
        initialize_result.instructions.as_deref(),
    )
    .await
    .map_err(StartupOutcomeError::from)?;
    // ...
    let managed = ManagedClient {
        // ...
        tool_catalog: Arc::new(ClientToolCatalog::new(
            client_tools,
            codex_apps_tools_cache_context
                .as_ref()
                .and_then(ConnectorRuntimeContext::subscribe),
        )),
```

`list_tools_for_client_uncached` 内部：https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/codex-mcp/src/rmcp_client.rs#L657-L680

```rust
pub(crate) async fn list_tools_for_client_uncached(
    // ...
) -> Result<Vec<ToolInfo>> {
    // ...
    let tools = collect_paginated_with_limit("tools/list", timeout, catalog_item_limit, |params| {
        let client = Arc::clone(client);
        async move {
            let response = client
                .list_tools_with_connector_ids(params, timeout)
                .await?;
```

### C3. 下一请求的 `tools` 数组 = Direct specs

主张：采样请求的 tools 字段是 `model_visible_specs`，且 builder 跳过非 Direct。

https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/session/turn.rs#L1562-L1572

```rust
pub(crate) fn build_prompt(
    input: Vec<ResponseItem>,
    step_context: &StepContext,
    base_instructions: BaseInstructions,
) -> Prompt {
    let turn_context = &step_context.turn;
    Prompt {
        input,
        tools: step_context.tool_router.model_visible_specs(),
```

https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/tools/spec_plan.rs#L553-L566

```rust
fn build_model_visible_specs(
    // ...
) -> Vec<ToolSpec> {
    let mut specs = Vec::new();
    for tool in registry.entries() {
        let exposure = tool.exposure;
        if !exposure.is_direct() {
            continue;
        }
```

https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/mcp_tool_exposure.rs#L85-L90

```rust
    let exposure = if search_tool_enabled {
        ToolExposure::Deferred
    } else {
        ToolExposure::Direct
    };
```

### C4. Deferred 目录变化通过对话 world-state（非整表塞进 tools 数组）

主张：feature `deferred_tool_world_state` 开启时，把 deferred namespaces 放进 world-state；diff 文案为 Added/Removed deferred tool namespaces。

https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/session/world_state.rs#L279-L287

```rust
        if turn_context
            .config
            .features
            .enabled(Feature::DeferredToolWorldState)
        {
            world_state.add_section(ToolsState::new(
                step_context.tool_router.deferred_tool_namespaces(),
                Arc::clone(&extension_metrics),
            ));
        }
```

https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools.rs#L118-L149

```rust
            PreviousSectionState::Known(previous) => {
                let added = self
                    .deferred_namespaces
                    .iter()
                    .filter(|(namespace, description)| {
                        previous.get(*namespace) != Some(*description)
                    })
                    // ...
                    .collect();
                let removed = previous
                    .iter()
                    .filter(|(namespace, _)| !self.deferred_namespaces.contains_key(*namespace))
                    // ...
                    .collect();
                render_namespace_groups(
                    &[
                        ("Added deferred tool namespaces", &added),
                        ("Removed deferred tool namespaces", &removed),
                    ],
                    self.deferred_namespaces.is_empty(),
                )
            }
        };
        // ...
            fragment: RenderedWorldStateFragment::new(
                "developer",
                (TOOLS_OPEN_TAG, TOOLS_CLOSE_TAG),
                rendered.body,
            ),
```

单元测试渲染结果：https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools_tests.rs#L108-L111

```rust
    assert_eq!(
        rendered,
        "<tools>\nAdded deferred tool namespaces:\n- app: control the Codex App\n- gmail: access your Google Gmail Account\nRemoved deferred tool namespaces:\n- hotline: access hotline information\n</tools>"
    );
```

Feature 默认关闭（UnderDevelopment）：https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/features/src/lib.rs#L1421-L1426

```rust
    FeatureSpec {
        id: Feature::DeferredToolWorldState,
        key: "deferred_tool_world_state",
        stage: Stage::UnderDevelopment,
        default_enabled: false,
    },
```

### C5. tool_search / namespace 面（feature 关 world-state 时）

主张：未开 `DeferredToolWorldState` 时，`tool_search` 描述里 Include sources；开启则 Omit（改由 world-state 负责）。

https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/tools/spec_plan.rs#L1458-L1474

```rust
fn append_tool_search_executor(
    // ...
) {
    let source_listing = if turn_context
        .config
        .features
        .enabled(Feature::DeferredToolWorldState)
    {
        ToolSearchSourceListing::Omit
    } else {
        ToolSearchSourceListing::Include
    };
    let handler = tool_search_handler_cache.get_or_build(registry, source_listing);
    registry.register_trusted(handler);
}
```

https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/tools/handlers/tool_search_spec.rs#L86-L95

```rust
            format!(
                "\n\nYou have access to tools from the following sources:\n{source_descriptions}\n"
            )
        }
        ToolSearchSourceListing::Omit => "\n\n".to_string(),
    };

    let description = format!(
        "# Tool discovery\n\nSearches over deferred tool metadata with BM25 and exposes matching tools for the next model call.{source_section}Some of the tools may not have been provided to you upfront, and you should use this tool (`{TOOL_SEARCH_TOOL_NAME}`) to search for the required tools. For MCP tool discovery, always use `{TOOL_SEARCH_TOOL_NAME}` instead of `list_mcp_resources` or `list_mcp_resource_templates`."
    );
```

### C6. Deferred namespace 摘要来源

主张：world-state 用的 map 来自 registry 里 Deferred 且带 namespace 的工具描述。

https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/tools/registry.rs#L443-L474

```rust
    pub(crate) fn deferred_tool_namespaces(&self) -> BTreeMap<String, String> {
        let mut namespaces = BTreeMap::<String, String>::new();
        for (name, tool) in &self.tools {
            if !tool.exposure.is_deferred() || name.is_default_namespace() {
                continue;
            }
            let Some(namespace) = &name.namespace else {
                continue;
            };
            // ... take Namespace description ...
        }
        namespaces
    }
```

## 待验证

1. **生产/默认产品配置是否打开 `deferred_tool_world_state`**：源码 default 为 `false`；实际 release 是否用远程 feature flag 覆盖，本调研未查配置下发面。
2. **普通（非 Codex Apps）MCP 在长连接期间有没有任何旁路会调用 `ClientToolCatalog::refresh`**：已见 Apps 显式 refresh 与 runtime 重建；未找到 list_changed 或周期性 re-list 对普通 Local catalog 的调用。若存在第三方扩展改写 ClientHandler，未覆盖。
3. **Direct 模式下“工具集合不变但 description/schema 微变”是否仍完整重发 tools 数组**：`build_model_visible_specs` 每步重建；是否与 provider 侧做 diff/cache 属 API 层，未追 Responses 客户端序列化。

## 来源覆盖（本笔记范围）

| 面 | 状态 |
|---|---|
| openai/codex `codex-rs` 源码 @ 钉死 SHA | 已读 |
| MCP list_changed → client handler | 已读 |
| tools/list → catalog → binding → ToolRouter → Prompt.tools | 已读 |
| DeferredToolWorldState / tool_search | 已读 |
| Claude Code / Pi / OpenCode | 边界外，未查 |
| 提示词全文 / 时机失败长 trace | 边界外，未展开 |
| 旧笔记 `_openai-native-tool-search.md` | 未复述（那是 OpenAI API tool search，不是 Codex CLI 路径） |

## 一句话对照用户三选项

| 通道 | Codex 是否用它通知「目录变了」 |
|---|---|
| 下一请求 `tools` 数组 | **Direct MCP**：是（整表/namespace 出现在 `Prompt.tools`）。**Deferred MCP**：否（本体不进数组；只有 `tool_search` 等 Direct 项）。 |
| `tool_search` / namespace | **Deferred**：是——用 search 拉 schema；namespace 列表在 search 描述或 world-state 里。 |
| 对话消息 | **仅当 `DeferredToolWorldState` 开启**：developer `<tools>` world-state 发 Added/Removed/初始 snapshot；不是 MCP notification 直达。 |
| `list_changed` 通知 | **不驱动上述任一通道**（只日志）。 |
