---
jn_type: task
jn_stage: null
jn_state: closed
jn_closed_reason: completed
---

父需求：[Harness Playbook 问题核验与分阶段收敛](./prd.md)
草稿标识：T3

## 交付结果

Edit 在全量读取目标文件前执行大小预检，超限时返回明确领域错误，覆盖父 PRD 的 AC7、AC9。

## 范围

做：使用 execution environment 现有 filesystem `stat` contract；在 Edit owner 内定义或复用固定阈值；统一覆盖 Edit 的所有全量读取路径；增加边界与错误测试。

不做：重写为流式 patch、限制流式 Read、增加用户配置、处理目录/SQLite/归档或建立通用资源物化器。

## 背景与约束

`packages/agent/src/harness/tools/edit.ts` 在匹配和替换前整文件读取，当前没有大小检查。该工具的算法需要完整文本，本任务用前置熔断限制内存风险。

错误使用 `better-result` 和 `TaggedError`，`_tag` 遵循 `<subsystem>.<reason>`。阈值属于 Edit 的安全约束，不新增配置层。错误文案应指出实际大小、允许上限和可行替代方式，但跨边界 DTO 不携带 cause 或 stack。

## 前置交付物

无。该任务可与 T1、T2、T4 并行。

## 开始前核对

- 读取父 PRD、当前任务、相关项目规则和前置交接。
- 确认范围已获授权、前置成果在当前环境可用。
- 检查是否已有执行者及工作目录中的重叠改动；冲突时不接管或覆盖。

## 验收条件

- [x] Edit 在任何全量读取发生前调用 `stat` 并比较文件大小。
- [x] 小于或等于阈值的现有编辑行为不变。
- [x] 超限文件返回稳定、可测试的 `TaggedError`，不会读取文件正文。
- [x] `stat` 失败沿用 filesystem contract 的错误语义，不被改写为超限错误。
- [x] 测试覆盖阈值内、阈值边界、超限和 `stat` 失败，并证明超限路径未调用 read。

## 检查方式

在仓库根目录运行：

```bash
bun run --cwd packages/agent typecheck
bun test packages/agent
```

检查未通过或缺少证据时保持任务打开。完成后执行记录写入实际输出、代码位置、局部决定、限制和交接，才能以 completed 关闭。

## 执行记录

2026-09-21，Codex 在 `/Users/jayden/code/jai-mono` 完成，未提交。

- 在 Edit owner 内定义固定 10 MiB 全量编辑上限，并新增 `tool.edit.file_too_large` TaggedError，携带实际字节数和上限。
- 两次 `readFile` 前均调用 filesystem `stat`：首次阻止超限正文加载，第二次避免并发修改期间文件膨胀绕过限制。
- `stat` 失败不捕获、不改写，沿用 filesystem contract 的错误语义。
- 测试覆盖阈值内、恰好阈值、超限不读正文和 `stat` 失败不读正文。
- `bun run --cwd packages/agent typecheck`：通过。
- `bun test packages/agent`：244 pass，0 fail。
- `git diff --check`：通过。

改动位置：`packages/agent/src/harness/tools/edit.ts`、`packages/agent/test/harness/tools/edit.test.ts`。
