# 需求说明: Todo 与 Subagent 扩展化

日期:2026-09-09

## 问题
Todo 与 Subagent 当前由 Coding Agent runtime 专门创建和注册，工具名单、权限、状态读取与提示词中存在专用逻辑，不能像已有官方 Extension 一样独立装配。

## 期望结果
Todo、Subagent 分别作为官方 Extension 提供，通过 SDK 的 extensions 安装；未安装时不注册工具、不注入上下文、不启动相关生命周期。删除旧内置注册方式，同时保留安装后的现有行为。

## 影响范围
会改到的模块: Coding Agent SDK/runtime/权限/工具与测试，官方 Extension 包的两个领域模块及打包入口，Server 的 ACP Todo 投影与相关测试、调用示例，以及受影响的项目规则说明。
长期保存的数据与维护方: Todo 业务状态由 Todo Extension 维护，经现有 Extension sessionState 写入 Agent journal；Extension 通用状态机制仍属于 Coding Agent，durable journal 仍由 Agent 的 SQLite 维护。Subagent 不新增长期保存的数据。

## 边界
不改 Artifact；不新增多层委派、后台任务、send/wait/resume 工具、独立 worktree、模型选择、持久化子会话或产品开关页面。不读取旧 Todo 路径、不写迁移或兼容层。不自动把此前默认关闭的能力在产品中打开。

## 工作量
大。需要两项独立的能力迁移，以及调用方、协议与打包的收尾验证。

## 已确认的现状
- `packages/coding-agent/src/tools/names.ts` 的默认工具只有 Read/Bash/Edit/Write；UpdateTodos 与 SpawnAgent 需要显式选择。
- `packages/coding-agent/src/runtime/create-coding-agent.ts` 拥有 Todo 写入、上下文注入、子 Agent 创建和主 Agent 工具注册。
- `packages/coding-agent/src/sdk/extensions/contract.ts` 已提供 tools、sessionState、beforeModelCall、lifecycle；尚未提供子执行入口或工具进度回调。
- `packages/coding-agent/src/sdk/create-coding-agent.ts` 仍提供专用 state.todos；公共 state 尚无 Extension 状态读取接口。
- `app/server/src/protocol/acp-v2/agent.ts` 根据 journal 的顶层 todos 生成 ACP plan；状态路径变化必须同步处理，包括清空计划。
- 官方扩展位于 `packages/extension`，通过独立包子路径导出。

## 参考对象
[pi-subagents 调研](../research/tools/pi-subagents.md)：只借鉴 Extension 拥有委派规则、复用通用 SDK 执行能力的分工，不要求行为兼容。JAI 仍遵循自身 Extension 契约、权限与持久化约束。
