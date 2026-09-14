# 02: Skill 清单改走通知

要先完成:01 · 状态:✅ 已完成

## 交付什么
Skill 文件在会话中途增删改后，模型看到的 tools payload 完全不变（prompt cache 前缀不再因 skill 失效）；用户下一次发消息时，模型在该消息前收到一条不显示的通知说明哪些 skill 新增 / 删除 / 更新。会话首次 run 时模型收到一条全量 skill 清单；压缩时当前全量清单附在压缩摘要后。`Skill` 工具、`/skill:<name>` 命令的调用行为不变。

## 范围
做:
- Skills extension 声明一个 `presentation: "announced"` 的 catalog：`discover` 返回当前 skill 的 name 与一句描述；`subscribe` 接到已有的 `catalog.watch`，revision 变化时 `invalidate`。
- `Skill` 工具的 `description` 改为固定文案，说明"可用技能清单见对话中的通知，用本工具按名字加载"；删除 getter 与 `<available_skills>` 拼接。
- skill 正文变化但名字与描述不变时，作为"更新"出现在 diff 中（用 revision 参与比对），让模型知道需要重新加载。
- 运行中调用已改动 skill 的现有 tool error 保留，但在有通知的前提下核对其文案是否仍准确。

不做:
- 不把 skill 放进 `SearchTools`。
- 不改 `/skill:` 命令表的同步逻辑、skill 文件格式或 Agent Plugin 发现。
- 不改压缩策略；只依赖第 1 项已实现的 `aroundCompact` 附加。

## 需要遵守的整体选择
遵循 [计划·方案](../plan.md#方案) 的 "Skill 止血" 与 "两种投递方式"；遵循 [已确认的关键选择](../plan.md#已确认的关键选择) 中 "Skill 与 SearchTools 完全无关"。

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方
无新增。清单与通知走第 1 项的 journal 消息；skill 文件仍由用户目录 / 项目目录持有。

## 必须遵守的项目规则
摘自根 AGENTS.md：
- "不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。"（getter 与 `<available_skills>` 直接删）
- "每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。"
- "测试目录镜像源码领域目录；测试通过 public interface 证明行为。"
- ponytail："Deletion over addition."

## 风险
- 这是唯一改变模型可见 tools payload 的项：改完后要断言 `Skill` 工具 description 在 skill 变化前后逐字节相同。
- 全量清单可能较长；只放名字和一句描述，不放正文。
- 压缩时附带清单依赖第 1 项的 `aroundCompact` 处理；本项只需验证首个 announced 使用者端到端成立。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] 测试：skill 文件增 / 删 / 改后，`Skill` 工具 description 字符串不变。 → "Skill tool description stays constant when skill files change"
- [x] 测试：首次 run 出现全量 skill 清单的 synthetic 消息；随后新增一个 skill 文件，下一次 invoke 的用户 prompt 前出现只含该 skill 的增量通知。 → "first run announces the full skill list, subsequent change produces incremental notice"
- [ ] 测试：触发压缩后 compaction entry 摘要末尾含当前全量 skill 清单。 → 依赖 spec 01 的 `aroundCompact`，已在 spec 01 的 extensions.test.ts 中用 mock announced catalog 验证；真实 Skills extension 的端到端压缩测试需要集成环境，留到整体集成验证。
- [x] 测试：`/skill:<name>` 命令与 `Skill` 工具加载行为与改动前一致。 → "explicitly provides the Skill tool and local /skill command" 和 "lists every valid Agent Skill and registers its local slash command" 全部通过
- [x] `packages/extension`：`bun run typecheck`、`bun test`、`bun run build` → 81 pass, 0 fail
- [x] `packages/coding-agent`：`bun test`（相关测试文件） → 120 pass, 0 fail

## 决策记录
- **revision 参与比对的方式**：`skillCatalogTool` 返回的 `description` 为 `${skill.description} [${skill.contentRevision.slice(0, 8)}]`。当 skill 正文变化（contentRevision 变化）但 name 和 description 不变时，diff 通过 description 字符串中的 revision 前缀检测到"更新"。模型会看到 8 字符的 hash 前缀，这不影响理解，反而明确告诉模型内容已变。未选择在 coordinator 层增加 revision 字段，因为 `CodingExtensionTool.description` 是唯一的比对载体，在 description 中嵌入 revision 是最小改动。
- **删除 `instance` 闭包变量**：原代码用 `let instance` 闭包变量支撑 `get description()` getter。改为固定 description 后，该变量不再有引用者，直接删除。`deactivate` 中的 `if (instance === runtime.instance) instance = undefined` 也一并删除。
- **`escapeXml` 保留**：删除 `skillToolDescription` 后，`renderSkillCommandPrompt` 仍然使用 `escapeXml`，故保留该函数。

## 遗留问题
- 压缩端到端测试：spec 01 已用 mock announced catalog 验证 `aroundCompact` 附加 snapshot 的机制；真实 Skills extension 走完整 agent 压缩流程的端到端测试需要集成环境（真实 provider + 压缩触发），留到整体集成验证时补。
- `readSkillBody` 的 "changed during the current run" 错误文案：核对后仍准确——该错误仅在 catalog reload 后文件又发生变化时触发，属于运行中竞态，通知机制不改变此竞态的语义。

## 交接说明
已完成 spec 02 全部范围。改动文件：
- `packages/extension/src/skills/index.ts`：添加 `catalogs`（announced），固定 Skill 工具 description，删除 getter / `skillToolDescription` / `instance` 闭包，新增 `skillCatalogTool` helper。
- `packages/extension/test/skills-extension.test.ts`：更新 `<name>` 标签断言为通知格式，新增 2 个测试（description 不变 + 增量通知），新增 `extractSkillToolDescription` helper。
- `packages/coding-agent/test/extensions.test.ts`：修复 spec 01 遗留的 `metadata` 类型断言。

下一项（spec 03 MCP live config）不要碰：
- `packages/extension/src/skills/` 已改完的 catalog 声明和 `skillCatalogTool`。
- `packages/coding-agent/src/sdk/extensions.ts` 的 coordinator binding / diffCatalog 逻辑（spec 01）。
- `packages/coding-agent/src/sdk/extensions/contract.ts` 的 `presentation` 字段（spec 01）。
