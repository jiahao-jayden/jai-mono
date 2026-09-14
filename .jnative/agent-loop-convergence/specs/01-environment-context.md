> 已于 2026-09-14 迁移至 [GitHub Issue #60](https://github.com/jiahao-jayden/jai-mono/issues/60)。本文件仅保留历史，不再更新任务进度；当前状态以 Issue 为准。

# 01: 环境事实进模型与搜索越界纠正

要先完成:无 · 状态:⏸ 等待既有 Skills 测试修复

## 交付什么
模型在每个 Operation 的第一次请求就知道：当前 cwd、workspace 根、还允许读的目录、当前权限模式，以及“目标不在这些范围内时先向用户要路径或授权，不向父目录扫描”的规则。用 `find` / `grep` 传绝对路径或 `../` 时，报错直接告诉它 workspace 根是哪、`path` 必须是根内的相对路径。同一句“看看我最新的 we0 项目”在绑定了 Project 的 Session 里，模型第一轮就应在 workspace 内搜一次，搜不到则提问，而不是 `pwd` → `ls ..`。

## 范围
做:
- Coding Agent 装配 system prompt 时追加一段环境说明，段内不含时间戳等每次不同的值。字段与来源固定为：
  - `cwd`：`executionContext.cwd`。
  - workspace root：就是 `cwd`，单值。依据是 FFF `find` / `grep` 的 `basePath` 取 `context.cwd`，`createCodingAgent` 也把 `defaultAllowedDirectories` 装配为 `[cwd]`；模型看到的 root 必须和工具实际检查的边界是同一个值，否则纠正文案会自相矛盾。
  - additional readable directories：`defaultAllowedDirectories` 中除 `cwd` 以外的条目，列表；为空时整行省略。今天恒为空，写进 spec 是为了在类型允许多目录的情况下不留歧义，而不是为将来预留功能。
  - permission mode：`permissionMode`。
- 不存在“`cwd` 不在允许目录内”的情形：`defaultAllowedDirectories` 由 `cwd` 派生，类型是非空元组且首位是 `cwd`。若实现时发现两者可以分离，停下来回 plan.md 记录，不要在 prompt 里自行解释。
- 默认指令里“Known files outside the workspace: Read them directly”保留，并补上越界行为规则。
- FFF `find` / `grep` 的 `outside_boundary` 错误文案带上 workspace root（即搜索工具自己的 `basePath`，与 system prompt 中的 root 同源）与“`path` 必须是 root 内的相对路径”的提示。
- 一个 coding-agent 测试：构造 Agent 后第一次 provider 请求的 system prompt 含 cwd 与允许目录。一个 extension 测试：`find` 传绝对路径时错误文本含 workspace 根。

不做:
- 不注入 MCP server 名称、Project 名称以外的 Desktop metadata。
- 不做增量更新；cwd 在 Operation 内不变。
- 不改 Bash 的目录检查。
- 不改 `SearchTools` / `ExecuteTool`。

## 需要遵守的整体选择
- [环境事实放 system prompt，不放每轮 synthetic 消息](../plan.md#计划内已定的选择)
- [Codex 作行为参考，差异见外部约定](../plan.md#外部产品或规范的约定)

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方
无。system prompt 是请求级内容，不写 journal。

## 必须遵守的项目规则
- "选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。"
- "不要仅为了'看起来模块化'提取两三行命名函数。"
- "领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`。"
- "测试目录镜像源码领域目录；测试通过 public interface 证明行为。"
- ponytail："non-trivial logic leaves ONE runnable check behind"。

## 风险
- system prompt 变长会让所有 Operation 的 cache 前缀失效一次；环境段必须不含每次不同的值。
- FFF 报错含绝对路径进入模型上下文，与环境段一致，不是新泄露；确认 Desktop 对工具错误文本的展示不截断关键部分。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [ ] 构造 Coding Agent 后第一次 provider 请求的 system prompt 含 cwd、允许目录与越界规则（测试断言）
- [ ] `find({ path: "/abs" })` 的错误文本含 workspace 根与相对路径提示（测试断言）
- [ ] `packages/coding-agent`：`bun run typecheck`、`bun test`
- [ ] `packages/extension`：`bun run typecheck`、`bun test`
- [ ] 改到 SDK 对外类型时：`packages/coding-agent` 的 `bun run build`、`bun run test:consumer`

## 决策记录
- 环境段由 public SDK 在调用 internal runtime 前装配。Server 和 Desktop 都经由这条入口创建 Agent；不在 runtime 再加第二套拼接逻辑。
- FFF runtime 显式持有激活时的 `basePath`。错误文本使用同一个值，避免模型看到的 workspace 根与工具实际搜索根不一致。

## 遗留问题
- `packages/extension` 全量 `bun test` 有两项既有 Skills Extension 失败：技能清单仍作为 user message 出现、首次 Skill 清单通知未找到。两项均在 `test/skills-extension.test.ts`，与本项无共享实现文件；未扩展范围处理。

## 交接说明
- 已完成环境 system prompt 和 FFF 越界文案。定向测试与两个 typecheck 通过；继续第 02 项时不要修改这两处以处理 Skills 通知测试失败。
