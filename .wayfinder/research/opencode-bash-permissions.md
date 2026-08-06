# OpenCode Bash 权限实现调研

调研对象：官方仓库 `anomalyco/opencode`，源码快照 `61eabfc60c1005d1b2b11849d70696a3dcef293e`（本地 checkout 的 `origin` 为 `https://github.com/anomalyco/opencode.git`）。以下引用均指向该官方仓库的源码文件。

## 结论摘要

- 配置动作只有 `allow`、`deny`、`ask`；权限项既可写单字符串（等价于 `"*"` 模式），也可写“pattern -> action”对象。Bash 配置键是 `bash`。
- 规则匹配同时匹配权限名和 pattern，使用 OpenCode 的 `Wildcard.match`；把所有规则集合扁平化后，`findLast` 选择最后一个匹配项。因此顺序是实际优先级，后加载/后合并的规则可以覆盖前面的规则；没有匹配时默认 `ask`。
- Bash 不把整条 shell 字符串当作一个不可解释的权限请求。它用 tree-sitter-bash（Windows PowerShell 用 tree-sitter-powershell）解析 AST，遍历所有 `command` 节点，所以 `a && b`、管道、命令替换等语法中的多个命令会分别进入扫描。
- 每个命令产生两个 Bash 请求集合：`patterns` 是命令节点的原文（用于当前调用判断）；`always` 是由命令 token 和 `BashArity` 词典生成的稳定前缀加 ` *`（用于“always”批准未来相同命令族）。词典示例：`git` 为 2 token，`git remote` 为 3，`npm run` 为 3，未收录命令退化为首 token。
- 文件路径参数会被单独解析。对 `rm/cp/mv/mkdir/touch/chmod/chown/cat` 等命令，OpenCode 解析路径并对工作区外目录发出 `external_directory` 权限请求；动态变量、命令替换、glob 前缀等无法安全解析时不推断路径。
- “always”不是硬编码的危险命令保护：批准后只是把请求声明的 `always` pattern 追加为 `bash: allow` 规则。当前官方快照中 Bash 扫描器没有看到专门将 `rm`、重定向或 `git clean` 强制设为 `ask/deny` 的内建 deny；若需要“删除始终确认”，应在 Jai 增加不可覆盖的风险层。
- 项目级持久化的设计是 SQLite `permission` 表，以 `project_id` 为主键、`data` 为 JSON ruleset。服务初始化时按当前 project 读取；但本快照的 `reply(always)` 只 `approved.push(...)` 内存数组，未发现对应的 insert/update 写回调用，需在迁移时避免照搬这一缺口。

## 规则语法与归一化

配置 schema：[`packages/opencode/src/config/permission.ts`](https://github.com/anomalyco/opencode/blob/61eabfc60c1005d1b2b11849d70696a3dcef293e/packages/opencode/src/config/permission.ts#L6-L69)。动作是三值联合。每个权限键的值是动作字符串或对象；字符串会归一化为 `{ "*": action }`。对象 key 是 pattern，例如：

```json
{
  "permission": {
    "bash": {
      "git status": "allow",
      "rm *": "ask",
      "*": "ask"
    }
  }
}
```

（上例展示完整配置文件中的顶层 `permission` 键。）配置 schema 注释明确说明运行时保留用户 key 顺序，以支持优先级。

`fromConfig` 把每个权限键转换成 `{ permission, pattern, action }` 规则；`~/`、`~`、`$HOME` pattern 会展开到 home 目录。来源：[`packages/opencode/src/permission/index.ts`](https://github.com/anomalyco/opencode/blob/61eabfc60c1005d1b2b11849d70696a3dcef293e/packages/opencode/src/permission/index.ts#L283-L309)。

## 匹配与优先级

核心实现 [`packages/opencode/src/permission/evaluate.ts`](https://github.com/anomalyco/opencode/blob/61eabfc60c1005d1b2b11849d70696a3dcef293e/packages/opencode/src/permission/evaluate.ts#L3-L15)：所有传入 ruleset `flat()` 后，用 `findLast` 找到同时满足 `Wildcard.match(permission, rule.permission)` 与 `Wildcard.match(pattern, rule.pattern)` 的规则；没有匹配返回 `ask`。这不是“deny 优先”算法，而是“最后匹配优先”。

服务在每个请求 pattern 上依次 evaluate；任一匹配为 `deny` 立即失败，全部为 `allow` 才放行，否则创建待处理请求。来源：[`permission/index.ts`](https://github.com/anomalyco/opencode/blob/61eabfc60c1005d1b2b11849d70696a3dcef293e/packages/opencode/src/permission/index.ts#L179-L214)。规则集合通常由 agent rules、session rules、approved rules 合并而成，调用方顺序决定覆盖关系。

## Bash 扫描、参数和复合命令

Bash 工具使用 tree-sitter parser，并对 AST 的所有 `command` 节点遍历：[`tool/bash.ts`](https://github.com/anomalyco/opencode/blob/61eabfc60c1005d1b2b11849d70696a3dcef293e/packages/opencode/src/tool/bash.ts#L252-L323)，[`tool/bash.ts`](https://github.com/anomalyco/opencode/blob/61eabfc60c1005d1b2b11849d70696a3dcef293e/packages/opencode/src/tool/bash.ts#L365-L394)。因此复合命令的每个子命令会形成独立 pattern；请求中任一子命令未被 allow 就会触发询问。

`patterns` 使用 AST 节点原文；`always` 使用 `BashArity.prefix(tokens)` 加 ` *`。词典最长前缀优先，且 flags 不增加 arity；未收录命令只取首 token。来源：[`permission/arity.ts`](https://github.com/anomalyco/opencode/blob/61eabfc60c1005d1b2b11849d70696a3dcef293e/packages/opencode/src/permission/arity.ts#L1-L10) 及词典定义。

路径扫描代码会过滤普通 flags，解析 `~`、环境变量和 PowerShell provider；包含 `$()`、反引号、动态变量或 glob 的路径不解析。工作区外路径按父目录聚合成 `external_directory` 请求，Bash 本身再按命令 pattern 请求权限。来源：[`tool/bash.ts`](https://github.com/anomalyco/opencode/blob/61eabfc60c1005d1b2b11849d70696a3dcef293e/packages/opencode/src/tool/bash.ts#L127-L210)、[`tool/bash.ts`](https://github.com/anomalyco/opencode/blob/61eabfc60c1005d1b2b11849d70696a3dcef293e/packages/opencode/src/tool/bash.ts#L258-L278)（路径解析与 ask）。

脚本调用（如 `bash cleanup.sh`）会被当成普通命令节点，稳定 always pattern 通常是 `bash *` 或词典前缀；OpenCode 不执行脚本内容做静态展开。因此脚本内部的删除/网络副作用不会被该扫描器单独识别。

## “always”批准与项目持久化

请求 schema 暴露 `patterns` 和 `always`，回复为 `once`、`always`、`reject`：[`permission/index.ts`](https://github.com/anomalyco/opencode/blob/61eabfc60c1005d1b2b11849d70696a3dcef293e/packages/opencode/src/permission/index.ts#L39-L72)。回复 `always` 时，服务将 `always` 中每个 pattern 追加为 `{ permission: existing.info.permission, pattern, action: "allow" }`，并自动放行当前 session 中已被这些规则覆盖的其它待处理请求：[`permission/index.ts`](https://github.com/anomalyco/opencode/blob/61eabfc60c1005d1b2b11849d70696a3dcef293e/packages/opencode/src/permission/index.ts#L216-L271)。

批准状态的 schema 是 project-scoped SQLite 行：[`session/session.sql.ts`](https://github.com/anomalyco/opencode/blob/61eabfc60c1005d1b2b11849d70696a3dcef293e/packages/opencode/src/session/session.sql.ts#L117-L123)。服务启动时按 `ctx.project.id` 读取 `PermissionTable` 的 JSON ruleset：[`permission/index.ts`](https://github.com/anomalyco/opencode/blob/61eabfc60c1005d1b2b11849d70696a3dcef293e/packages/opencode/src/permission/index.ts#L156-L164)。

注意：在本快照中没有找到 `reply(always)` 后写入 `PermissionTable` 的 insert/update；只有内存 `approved.push`。这可能是当前迁移中的未完成持久化路径，Jai 不应直接复制，应该把“项目授权写入配置/数据库”作为明确且可测试的事务。

## 危险命令保护与 Jai 迁移建议

OpenCode 的 Bash `FILES` 集合用于发现工作区外路径，包含 `rm`、`cp`、`mv`、`mkdir`、`touch`、`chmod`、`chown` 等，但这只导致 `external_directory`/`bash` 请求，并不等价于不可覆盖的删除保护。扫描器中未见对 `rm`、`rmdir`、`unlink`、`git clean`、文件截断重定向或任意脚本内容的硬编码 deny/ask；动作最终由规则匹配决定。

建议 Jai 借鉴的结构：

1. 保留 `{ permission, pattern, action }` 三元规则和单字符串 `"*"` shorthand；采用 glob/Wildcard，并明确“最后匹配胜出”的顺序语义。
2. 先用 shell AST 拆分复合命令，再对每个命令做请求；为常见 CLI 维护 arity/prefix 词典，`always` 只授权稳定命令族（例如 `git status *`），而不是把整条带参数命令永久放行。
3. 把路径访问与 Bash 命令权限分开：工作区外目录单独询问，避免仅靠命令白名单保护文件边界。
4. 在规则 evaluate 之前加入不可覆盖的风险分类：删除（至少 `rm/rmdir/unlink/git clean/find -delete`、危险重定向/截断）始终 `ask`；动态 shell、脚本解释器和无法解析的 AST 也按高风险处理。用户要求“删除必须确认”时，项目配置中的 `allow` 不能覆盖这一层。
5. “always”写入当前项目的持久化存储，并提供列出/撤销；写入应在回复成功后原子更新，且要有重启后仍生效的测试。
