# Codex：工具 / MCP 变更时注入给模型的原文

- 核验日期：2026-09-27
- 钉住 SHA：`8f195c93d7e7acfef95acf273f0e49cce917e291`（`openai/codex` `main`）
- 问题：工具或 MCP server 出现、消失、变更时，注入给模型的原文是什么？触发条件？角色是 developer / user / system？
- 边界：不重写 MCP 连接状态机；只钉文案常量、选择条件与角色。

## 搜索日志（短查询 → 命中/未命中）

| 查询 | 结果 |
|---|---|
| `"available tools"` | 命中多处（协作模式模板、multi-agent、skills catalog 等）；**不是**工具列表变更注入文案 |
| `"tools have"` | 命中 2；均为英文惯用语（如 “tools have finished”），**不是**更新文案 |
| `"tool list"` / `"tool list changed"` | `on_tool_list_changed` 仅在 `logging_client_handler.rs`；只打 log |
| `list_changed` / `on_tool_list_changed` | 同上；全仓唯一实现只 `info!`，不注入对话 |
| `"tools have changed"` | **0 命中** |
| `"Deferred tool namespaces"` / `"Added deferred"` / `"Removed deferred"` / `"No deferred tool namespaces remain"` | 命中 `tools.rs` + 单测/snapshot，**即目标文案** |
| `"additional namespaces omitted"` | 命中 `tools.rs` / `tools_tests.rs` |
| `"do not call"` | 命中 goal 模板、plugin install 等；**不在** `<tools>` 更新片段内 |
| `ToolsState::new` | 命中 `session/world_state.rs` + `tools_tests.rs` |
| `DeferredToolWorldState` | feature 定义 + 装配门控 + 集成测试 |
| `"mcp server"` + developer | 多命中；Apps 静态说明见下文，非 list-change 通知 |

## 结论摘要

1. 唯一针对「deferred 工具命名空间出现/变更/移除」的对话注入文案在 `ToolsState::render_diff`，角色固定为 **developer**，外层标签 `<tools>…</tools>`。
2. 该注入受 feature `DeferredToolWorldState`（`deferred_tool_world_state`）门控；默认 **关闭**（`UnderDevelopment` / `default_enabled: false`）。
3. 文案按 previous 状态分三套：首屏 snapshot 用 `Deferred tool namespaces:`；后续 delta 用 `Added…` / `Removed…`；清空时追加 `No deferred tool namespaces remain.`。
4. MCP `notifications/tools/list_changed` 在 Codex 侧只记日志，**不**直接拼对话消息。
5. Direct 暴露的工具走 API `tools` 字段；`<tools>` 片段只列 **namespace 名 + 短描述**，不含单工具 schema，也无 “do not call”。

---

## 发现 1 — 角色是 developer，标签是 `<tools>`

**主张：** 工具命名空间 world-state 片段的 response role 硬编码为 `"developer"`，markers 为 `<tools>` / `</tools>`；经 `ContextualUserFragment` 变成 `ResponseItem::Message { role: "developer", … }`。不是 user，不是 system。

**Permalink：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools.rs#L142-L149

**摘录：**

```rust
Some(Box::new(WorldStateContextFragment {
    fragment: RenderedWorldStateFragment::new(
        "developer",
        (TOOLS_OPEN_TAG, TOOLS_CLOSE_TAG),
        rendered.body,
    ),
    content_kind: ContentItemKind("tools.deferred_namespaces".to_string()),
}))
```

**Permalink（标签常量）：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/protocol/src/protocol.rs#L130-L131

```rust
pub const TOOLS_OPEN_TAG: &str = "<tools>";
pub const TOOLS_CLOSE_TAG: &str = "</tools>";
```

**Permalink（fragment → Message）：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/context-fragments/src/fragment.rs#L35-L52

```rust
impl From<RenderedFragment> for ResponseItem {
    fn from(fragment: RenderedFragment) -> Self {
        let (role, annotated_content) = fragment.into_parts();
        let (content, content_kind) = annotated_content.into_parts();

        Self::Message {
            id: None,
            role: role.to_string(),
            content: vec![content],
            // ...
        }
    }
}
```

集成测试 snapshot 亦显示 `message/developer` + `<tools>`：  
https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/tests/suite/snapshots/all__suite__mcp_tool_exposure__deferred_tools_initial_unchanged_and_removed.snap#L9-L15

---

## 发现 2 — 触发门控：`DeferredToolWorldState` + deferred namespace 快照变化

**主张：** 仅当 feature 开启时，每步 sampling 把 `deferred_tool_namespaces()` 装进 `ToolsState`；`render_diff` 在 previous==current、或首次即为空时返回 `None`（不注入）。

**Permalink（装配门控）：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/session/world_state.rs#L279-L288

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

**Permalink（feature 默认关闭）：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/features/src/lib.rs#L240-L241  
https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/features/src/lib.rs#L1421-L1426

```rust
/// Describe deferred tool namespaces in the model-visible world state.
DeferredToolWorldState,
// ...
FeatureSpec {
    id: Feature::DeferredToolWorldState,
    key: "deferred_tool_world_state",
    stage: Stage::UnderDevelopment,
    default_enabled: false,
},
```

**Permalink（何时不渲染）：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools.rs#L96-L109

```rust
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

---

## 发现 3 — 首屏文案（previous Absent/Unknown）：`Deferred tool namespaces:`

**主张：** 第一次需要告知模型时，正文标签为字面量 `"Deferred tool namespaces"`，行格式 `- {namespace}` 或 `- {namespace}: {description}`。

**Permalink：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools.rs#L111-L116

```rust
PreviousSectionState::Absent | PreviousSectionState::Unknown => {
    render_namespace_groups(
        &[("Deferred tool namespaces", &self.deferred_namespaces)],
        self.deferred_namespaces.is_empty(),
    )
}
```

**Permalink（期望整串，含标签）：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools_tests.rs#L74-L77

```rust
assert_eq!(
    rendered,
    "<tools>\nDeferred tool namespaces:\n- app: control the Codex App\n- gmail: access your Google Gmail Account & labels\n- hotline\n</tools>"
);
```

描述只取 namespace 说明的**第一行**，最长 250 字符（超长加 `...`）——见同文件 `ToolsState::new`（`tools.rs` L45–L75）。单工具 function description / JSON schema **不**进入此片段。

---

## 发现 4 — 后续变更文案：`Added…` / `Removed…`（描述变更也进 Added）

**主张：** previous 为 Known 且快照不等时，渲染两组标签字面量 `"Added deferred tool namespaces"` 与 `"Removed deferred tool namespaces"`；namespace 描述变化被算进 added（`previous.get != Some(description)`），没有单独的 “Updated” 标签。

**Permalink：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools.rs#L118-L138

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
```

**Permalink（整串期望）：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools_tests.rs#L108-L111

```rust
assert_eq!(
    rendered,
    "<tools>\nAdded deferred tool namespaces:\n- app: control the Codex App\n- gmail: access your Google Gmail Account\nRemoved deferred tool namespaces:\n- hotline: access hotline information\n</tools>"
);
```

**运行时 snapshot（Apps 恢复后出现 calendar namespace）：**  
https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/tests/suite/snapshots/all__suite__mcp_tool_exposure__deferred_tools_recover_during_sampling.snap#L22-L27

```
05:message/developer[2]:
    [01] <APPS_INSTRUCTIONS>
    [02] <tools>
        Added deferred tool namespaces:
        - mcp__codex_apps__calendar: Plan events and manage your calendar.
        </tools>
```

---

## 发现 5 — 全部移除时的空状态句

**主张：** 当前 deferred namespaces 为空且 previous 非空时，在 Removed 组之后追加字面量 `No deferred tool namespaces remain.\n`。

**Permalink：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools.rs#L159

```rust
let empty_state = current_is_empty.then_some("No deferred tool namespaces remain.\n");
```

**Permalink（整串期望）：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools_tests.rs#L388-L394

```rust
format!(
    "<tools>\nRemoved deferred tool namespaces:\n- {namespace}: lon...\n- z: sh...\nNo deferred tool namespaces remain.\n</tools>"
)
```

**集成 snapshot：**  
https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/tests/suite/snapshots/all__suite__mcp_tool_exposure__deferred_tools_initial_unchanged_and_removed.snap#L45-L50

```
06:message/developer:
    <tools>
    Removed deferred tool namespaces:
    - mcp__codex_apps__calendar: Plan events and manage your calendar.
    No deferred tool namespaces remain.
    </tools>
```

---

## 发现 6 — 预算截断提示：`... N additional namespaces omitted.`

**主张：** 字节预算不够时，组内省略整行后追加 `"... " + count + " additional namespaces omitted.\n"`。

**Permalink：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools.rs#L203-L206

```rust
if omitted > 0 {
    rendered.push_str("... ");
    rendered.push_str(&omitted.to_string());
    rendered.push_str(" additional namespaces omitted.\n");
}
```

---

## 发现 7 — `<tools>` 里只有 namespace，描述来自 Namespace spec（故意不含单工具全文）

**主张：** `deferred_tool_namespaces()` 只收集 `ToolExposure::is_deferred()` 且带 namespace 的工具；描述仅取 `ToolSpec::Namespace.description`，Function/ToolSearch 等记为空串。因此通知里**故意不包含**各工具完整 description/schema。

**Permalink：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/tools/registry.rs#L443-L474

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
        // ...
        let description = match spec {
            ToolSpec::Namespace(namespace) => namespace.description.as_str(),
            ToolSpec::Function(_)
            | ToolSpec::Freeform(_)
            | ToolSpec::ToolSearch { .. }
            | ToolSpec::WebSearch { .. } => "",
        };
        // ...
    }
    namespaces
}
```

**Permalink（Direct vs Deferred 语义）：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/tools/src/tool_executor.rs#L51-L62

```rust
pub enum ToolExposure {
    /// Include this tool in the initial model-visible tool list.
    Direct,
    /// Register this tool for later discovery, but omit it from the initial
    /// model-visible tool list. Deferred tools must provide search metadata via
    /// [`ToolExecutor::search_info`].
    Deferred,
```

---

## 发现 8 — MCP `list_changed` 不注入模型文案

**主张：** 全仓 `on_tool_list_changed` 仅 `LoggingClientHandler` 一处，只 `info!("MCP server tool list changed")`，无 developer/user/system 消息拼装。工具列表变更若最终反映到模型，需经 runtime 刷新 → registry/exposure →（可选）World State diff / API `tools`，而非本 handler 直注。

**Permalink：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/rmcp-client/src/logging_client_handler.rs#L82-L88

```rust
async fn on_resource_list_changed(&self, _context: NotificationContext<RoleClient>) {
    info!("MCP server resource list changed");
}

async fn on_tool_list_changed(&self, _context: NotificationContext<RoleClient>) {
    info!("MCP server tool list changed");
}
```

code search `on_tool_list_changed` / `"tool list changed"`：仅此文件。

---

## 发现 9 — MCP 工具默认进 Deferred（有 tool_search 时），否则 Direct（API tools）

**主张：** 注册 MCP 工具时：`search_tool_enabled` → `ToolExposure::Deferred`，否则 `Direct`。Direct 路径对应「初始 model-visible tool list」（API 字段），不走 `<tools>` world-state 文案（该文案只看 deferred namespaces）。

**Permalink：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/mcp_tool_exposure.rs#L85-L89

```rust
let exposure = if search_tool_enabled {
    ToolExposure::Deferred
} else {
    ToolExposure::Direct
};
```

feature 注释亦写明 MCP 在 tool_search 可用时始终 deferred：  
https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/features/src/lib.rs#L238-L239

```rust
/// Removed compatibility flag. MCP tools are always deferred when tool_search is available.
ToolSearchAlwaysDeferMcpTools,
```

因此：**默认 feature 关闭时**，没有「工具列表变更」的对话消息；模型侧更新主要体现在下一轮请求的 `tools` / `tool_search` 工具描述字段。开启 `deferred_tool_world_state` 后，才额外注入发现 3–5 的 developer `<tools>` 文案。

---

## 发现 10 — 相关但非「列表变更通知」的静态文案（含 “Do not additionally call”）

**主张：** Apps / tool_search 有固定 developer 或 tool-description 文案，指导如何发现 MCP/apps；它们不是 list-changed 事件模板。其中 Apps 含 “Do not additionally call list_mcp_resources…”。`<tools>` 更新片段本身**没有** “do not call”。

**Permalink（Apps，role=developer）：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/apps_instructions.rs#L16-L31

```rust
fn role(&self) -> &'static str {
    "developer"
}
fn body(&self) -> String {
    format!(
        "\n## Apps (Connectors)\nApps (Connectors) can be explicitly triggered in user messages in the format `[$app-name](app://{{connector_id}})`. Apps can also be implicitly triggered as long as the context suggests usage of available apps.\nAn app is equivalent to a set of MCP tools within the `{CODEX_APPS_MCP_SERVER_NAME}` MCP.\nAn installed app's MCP tools are either provided to you already, or can be lazy-loaded through the `tool_search` tool. If `tool_search` is available, the apps that are searchable by `tools_search` will be listed by it.\nDo not additionally call list_mcp_resources or list_mcp_resource_templates for apps.\n"
    )
}
```

**Permalink（tool_search 工具 description，挂在 API tools 字段）：** https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/tools/handlers/tool_search_spec.rs#L86-L95

```rust
format!(
    "\n\nYou have access to tools from the following sources:\n{source_descriptions}\n"
)
// ...
let description = format!(
    "# Tool discovery\n\nSearches over deferred tool metadata with BM25 and exposes matching tools for the next model call.{source_section}Some of the tools may not have been provided to you upfront, and you should use this tool (`{TOOL_SEARCH_TOOL_NAME}`) to search for the required tools. For MCP tool discovery, always use `{TOOL_SEARCH_TOOL_NAME}` instead of `list_mcp_resources` or `list_mcp_resource_templates`."
);
```

---

## 文案矩阵（条件 → 原文标签）

| 条件 | 注入？ | 角色 | 正文标签 / 句子（字面量） |
|---|---|---|---|
| feature 关 | 否（走 API `tools` / tool_search） | — | — |
| feature 开，previous Absent/Unknown，namespaces 非空 | 是 | developer | `Deferred tool namespaces:` |
| feature 开，previous Known，快照变化 | 是 | developer | `Added deferred tool namespaces:` / `Removed deferred tool namespaces:` |
| feature 开，全部移除 | 是 | developer | Removed 组 + `No deferred tool namespaces remain.` |
| feature 开，快照不变 | 否 | — | — |
| feature 开，首次即为空 | 否 | — | — |
| MCP `tools/list_changed` | 否（仅 log） | — | `MCP server tool list changed`（日志，非模型输入） |
| 预算溢出 | （附在上述片段内） | developer | `... N additional namespaces omitted.` |

整包渲染形状：`<tools>` + `"\n"` + 各组 `Label:\n` + `- name[: desc]\n` + 可选省略/空状态句 + `</tools>`。

---

## 待验证 / 未查到

- **未查到** 形如 `"tools have changed"` / `"available tools have been updated"` 的列表变更对话模板。
- **未逐行钉死** world-state `render_history_diff` → 写入 history → 进入下一轮 request 的完整调用链（边界交给 timing/path 调研）；文案与角色以上述常量为准。
- **未查** `codex-cli` TypeScript 是否另有一套平行文案（本 SHA 下目标逻辑在 `codex-rs`；指引称必要时才查 CLI）。
- `"Available tools"` 大小写精确搜索曾遇 API EOF；已有相关命中来自 `"available tools"`（小写短语，非更新模板）。
- 未验证生产默认配置是否通过 config 覆盖打开 `deferred_tool_world_state`（源码默认 `false`）。
