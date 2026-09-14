# Pi Agent：工具失败、纠错与上下文注入（最小调研）

> 范围：仅记录本轮已取得的 Pi 官方仓库提交 `f8c71c6a0693bc7f71f84e92783315d6a725a721`（2026-08-11）及其源码入口。仓库已从 `mariozechner/pi-mono` 迁移为 `earendil-works/pi`。本轮下载源码在网络沙箱阶段被用户中断，因此以下内容刻意只保留已能确定的架构结论，不对未复核的实现细节作推断。

## 核心发现

1. **工具失败会回到模型上下文。** Pi agent-core 的 agent loop 将每次工具调用的结果追加为下一轮模型可见的 tool-result message；工具执行抛出的异常会被转换为失败结果，而不是直接让整个会话失去下一轮。模型因此可以看到失败文本并自行决定 read、改参数、换方案或停止。

   一手源码入口：[agent loop](https://github.com/earendil-works/pi/blob/f8c71c6a0693bc7f71f84e92783315d6a725a721/packages/agent/src/agent-loop.ts)、[消息和工具结果类型](https://github.com/earendil-works/pi/blob/f8c71c6a0693bc7f71f84e92783315d6a725a721/packages/ai/src/types.ts)。

2. **没有看到通用、强制的“失败后必须 re-read 才能 retry” guard。** Pi 将纠错主导权留给模型：失败结果进入上下文，下一轮模型决定是否调用 Read/Edit。这个机制能让常规失败自然恢复，但不能保证模型不会拿旧 `oldText` 连续重试。

   相关源码入口：[coding-agent session](https://github.com/earendil-works/pi/blob/f8c71c6a0693bc7f71f84e92783315d6a725a721/packages/coding-agent/src/core/agent-session.ts)、[内置工具目录](https://github.com/earendil-works/pi/tree/f8c71c6a0693bc7f71f84e92783315d6a725a721/packages/coding-agent/src/core/tools)。

3. **Pi 的 system prompt / context injection 是显式拼装的 agent session 能力，不是隐藏的失败恢复器。** Coding-agent 在创建会话时组合基础系统提示、工作目录/环境信息、已注册工具和扩展注入内容；工具错误仍主要通过 tool-result message 传给模型。换言之，提示词适合给出“失败后如何做”的策略，但不能替代工具层提供精确错误与防循环约束。

   一手源码入口：[coding-agent session](https://github.com/earendil-works/pi/blob/f8c71c6a0693bc7f71f84e92783315d6a725a721/packages/coding-agent/src/core/agent-session.ts)、[coding-agent 文档](https://github.com/earendil-works/pi/tree/f8c71c6a0693bc7f71f84e92783315d6a725a721/packages/coding-agent/docs)。

## 对 Jai 的直接借鉴

### Edit `text_not_found`

- **保留 Pi 式基础：** 将结构化失败完整写回下一轮模型上下文，包含路径、失败码 `edit.text_not_found`、当前版本/内容摘要与“上一次读取版本”。不能只在 UI 显示红字。
- **在 Pi 之上增加产品 guard：** 同一路径发生 `text_not_found` 后，标记该路径为 `requiresRead`；在成功 `Read` 该路径前拒绝下一次 `Edit`，返回 `edit.read_required_after_conflict`。这解决截图中“使用过期 oldText 连续 Edit”的确定性循环，不能只靠 prompt。
- **提示词只作补充：** 明确写入：`Edit text_not_found 后先 Read 同一路径；以新内容重新构造一次 Edit；不得重复提交相同 oldText。`

### Browser / Node smoke test

- 失败的 Bash 输出应和 Pi 一样回到模型上下文；让模型看到 `innerWidth is not defined`、超时、退出码和截断后的 stdout/stderr，而不是只看到“Command failed”。
- 对 HTML/Canvas 产物，系统提示应优先要求真实浏览器 smoke test；Node 只用于不依赖 DOM、Canvas、RAF 的纯逻辑模块。
- 工具层应提供专用 browser runner，并把超时、页面 console、异常和截图/DOM 摘要作为结构化 tool result。禁止用“出现 `SMOKE OK` 就视为成功”的字符串规则：进程退出码与超时才是执行成功条件。
- 对临时 Node harness，要求测试命令显式退出或清理持续调度的 `requestAnimationFrame` stub；这应是 test harness 的行为约束，不应由 Automate 或 UI 掩盖。

## 结论

Pi 的关键可借鉴点是：**失败结果成为下一轮模型输入，纠错由 agent loop 延续。** 对 Jai 的 `text_not_found`，仅复制这个机制不够；应在此基础上用 `requiresRead` 强制状态机消除重复旧补丁。对 Canvas 游戏，优先提供真实浏览器工具和清晰的结构化失败结果；提示词用于选择正确的验证工具，而不是让模型手写不稳定的 DOM/RAF mock。
