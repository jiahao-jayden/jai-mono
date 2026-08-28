# Product

<!-- impeccable:product-schema 1 -->

## Platform

desktop (Electron, macOS 优先，兼容 Windows/Linux)

## Stack

Electron 43 + React 19 + Tailwind 4 + Vite 7 + Zustand + motion + streamdown
字体: Manrope (UI sans) · Source Serif 4 (品牌/display) · IBM Plex Mono (代码)
组件: Base UI + Radix + shadcn/ui (radix-nova neutral)

## Users

独立开发者和技术型创作者。他们已经在用 Claude Code / Cursor / ChatGPT Desktop，但觉得这些工具要么太 IDE 形态、要么太 chatbot 形态。他们需要一个始终在桌面上运行的本地 AI agent 伙伴——跨越编码、思考和任务执行。

## Product Purpose

PandaWork 是一个本地优先的桌面 AI coding agent。对话是主界面，agent 能直接理解并操作项目，但它不是一个代码编辑器。用户应该感到"平静、有能力、不孤单"——像桌上一盏温暖的灯，而非一个控制面板。

## Positioning

Agent-first 工作空间: 对话为主界面，直接理解并操作本地项目，同时支持本地模型和 API 模型。与 Cursor 的区别在于不做 IDE；与 Claude Desktop 的区别在于本地优先且 agent 能力是核心（不只是聊天）。

## Operating Context

- 常驻桌面，dock 中随时召唤
- 工作目录为项目文件夹，agent 在其中执行 read/write/bash
- 通过 gateway 连接本地模型 (Ollama, LM Studio) 或远端 API (Anthropic, OpenAI)
- 支持 Manual / Automate / Web 三种运行模式
- 产出 artifacts 直接写入本地文件系统

## Capabilities and Constraints

核心能力:
- 多模型对话 (streaming, reasoning, tool call, compaction)
- Agent 工具调用: read, write, edit, bash, fffind, ffgrep
- 项目工作区绑定
- 会话历史与恢复
- 权限请求审批
- Outputs / Progress / Context 面板

约束:
- 不是代码编辑器，不提供 editor buffer / LSP / syntax highlighting 编辑体验
- 数据完全本地存储，除非用户主动选择 API 模型
- 不做团队协作功能

## Brand Commitments

- 名称: PandaWork
- 品牌色: teal-green #3E8E7E (accent) / #31705F (deep)
- 人格: Gentle (温柔) · Crafted (精工) · Alive (有呼吸的)
- 吉祥物: 🐼 熊猫 (有状态、有微动画，不是静态 logo)
- 中英双语 UI: 中文用于情感性/面向用户的文案，英文用于产品名词和开发者概念

## Evidence on Hand

- 设计稿: `docs/PandaWork.dc.html` — 完整的三栏布局交互原型 (sidebar + chat + right panel)
- 已有代码: 窗口壳层、主题系统、RPC 协议、chat store (streaming + compaction + permission)
- Gateway 客户端: 已实现 session/message/config/plugin API 连接

## Product Principles

1. 对话即界面 — chat column 永远是房间，其他一切是家具
2. 本地优先 — 数据不离开机器，除非用户选择了远端模型
3. 安静胜过花哨 — 全天使用不疲劳，克制动效，不做注意力争夺
4. Agent 有温度 — 通过微动画、breathing cursor、状态指示让产品感觉活着，但永远不矫揉造作
5. 编辑权归用户 — agent 产出文件，用户用自己习惯的编辑器打开它们

## Accessibility & Inclusion

- 目标 WCAG AA
- 尊重 `prefers-reduced-motion`
- 明暗主题同等照顾
- 不使用纯色彩传递状态
