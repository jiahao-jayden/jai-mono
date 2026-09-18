# Tracker 操作约定

## 配置与选择

可选的仓库级配置位于 `.jnative/issue-tracker.md`，内容保持可直接读取：

```markdown
tracker: github
fallback: local
github_client: gh
```

`tracker` 只接受 `github` 或 `local`，`fallback` 只接受 `local`。`tracker: github` 时必须有 `github_client: gh`，不接受其他值。GitHub 仓库从 remote 获取，不在配置中复制。配置由 `jn-setup` 显式维护；普通 JN 不调用 setup、不创建或修改配置。配置不存在或 `github_client` 缺失时，GitHub 读写仍只用 `gh`；GitHub remote 明确且可访问则使用 GitHub，否则使用本地；fallback 始终是本地。不因 connector / GitHub MCP 可用就改走它们。

- `github`：父 PRD 和任务是 GitHub Issues，状态由 Issue、label、关系和评论承载。
- `local`：父 PRD 和任务是 `.jnative/task/<feature>/` 下的 Markdown，状态由 frontmatter、链接和执行记录承载。
- 已有父记录时沿用它所在的 tracker。切换已有需求须明确迁移，不能双写或持续同步。

GitHub 在创建任何对象前确认无 remote、无连接或无写权限时，本次运行改用本地；不自动创建或修改配置。超时、部分创建或结果不明时先按下文恢复；未确认远端没有对象前不得回退，避免产生两套记录。

## 轻量本地视图与归档

无论 tracker 类型，都维护两个只含父需求元数据的导航文件：

```text
.jnative/task/index.md
.jnative/task/history.md
.jnative/archive/YYYY-MM-DD/<feature-slug>/
```

`index.md` 只列打开的父需求，`history.md` 只列已完成、取消或迁移的父需求。不要使用表格；每个父需求使用一个二级标题，下面按行写 `阶段` 或 `结果`、`Tracker`、`更新时间` 或 `归档日期`、`本地历史`。Tracker 使用 GitHub Issue 链接或本地相对路径；没有旧本地资料时本地历史写 `-`。结果无法从权威记录确认时写 `unknown`，不能因目录位于 archive 下就猜成 completed。

这两个文件是可重建的投影视图，不复制 PRD、子任务正文、执行证据或依赖，不作为状态与恢复依据。创建、更新、关闭、重开或迁移父需求后更新对应行；普通当前工作只读 `index.md`，历史查询或旧需求匹配才读 `history.md`。需要刷新时只读取 tracker 的父需求标题、状态、阶段、更新时间和链接；旧文件只读开头的迁移标记来关联本地历史，不为重建视图加载全部正文或子任务。

local 父需求关闭后，以项目当前日期 `YYYY-MM-DD` 将 `.jnative/task/<feature-slug>/` 移到 `.jnative/archive/YYYY-MM-DD/<feature-slug>/`，再把该行从 `index.md` 移到 `history.md`。归档前先修复目录内相对链接；目标已存在时先确认是同一需求，不能覆盖。重开时把目录移回 `.jnative/task/<feature-slug>/`，把历史行移回当前视图。GitHub Issue 本身留在 GitHub，只移动视图中的行，不在本地复制正文。

旧 `.jnative/<feature>/` 和 `.jnative/archive/<feature>/` 目录不因启用视图自动移动，避免破坏已有相对链接；用户明确要求重新整理它们时，才按操作当天日期移动并修复链接。

## GitHub 发布和关系

进入 GitHub 模式后先读配置里的 `github_client`。值为 `gh` 或字段缺失时，所有读取和写入只走 `gh` / `gh api`：Issue、评论和标签用 `gh issue`、`gh label`；父子关系、依赖和关闭原因用 `gh api`。需要未知 API 时先查 `gh` 帮助和 GitHub 官方文档，不猜端点、参数、ID；不为这套流程增加专用服务。

不使用 GitHub connector、GitHub MCP，以及 `issue_write`、`issue_read`、`list_issues`、`sub_issue_write` 等 connector 工具。这些工具在会话里可见、只要读一眼、或 `gh` 暂时失败，都不能改走 connector；`gh` 不可用时按配置回退本地，不回退 connector。

`gh issue create` 不能挂父 Issue。正文里的 `#65`、任务列表或“前置任务”链接都不会出现列表页上的 `0/8` 进度圈。那个圈只来自 GitHub 原生 **sub-issue**，由 `sub_issues_summary.completed/total` 自动计算。

三种关系不要混：

| 关系 | 作用 | 会不会出进度圈 |
|---|---|---|
| sub-issue（父子） | 子任务属于哪个父 PRD | 会 |
| blocked_by（依赖） | 谁挡住谁，用于调度 | 不会 |
| 正文链接 / `- [ ] #n` | 给人看 | 不会 |

API 里的 `id` 是 REST 数字数据库 ID，不是 Issue 编号，也不是 `gh issue view --json id` 的 GraphQL node ID。

```bash
# 取 REST id，并看进度圈是否已出现
gh api repos/{owner}/{repo}/issues/{number} --jq '{id,number,sub_issues_summary}'

# 已有子 Issue：挂到父 Issue（sub_issue_id 必须是子 Issue 的 REST id）
gh api repos/{owner}/{repo}/issues/{parent_number}/sub_issues -F sub_issue_id={child_id}

# 或创建子 Issue 时直接带父（parent_issue_id 也是 REST id）
gh api repos/{owner}/{repo}/issues --input - <<'EOF'
{"title":"[T1] ...","body":"...","labels":["jn:task","jn:ready"],"parent_issue_id":123456789}
EOF

# 依赖（调度用，替代不了父子）
gh api repos/{owner}/{repo}/issues/{blocked_number}/dependencies/blocked_by -F issue_id={blocker_id}

# 发布后必须核验；total 对不上就还没挂上
gh api repos/{owner}/{repo}/issues/{parent_number} --jq .sub_issues_summary
gh api repos/{owner}/{repo}/issues/{parent_number}/sub_issues --paginate --jq '.[].number'
```

1. 先核对仓库、已有父 Issue 和授权范围。对新需求先发父 PRD，再发子任务。
2. 草稿用 T1、T2 等任务标识，父需求内不复用；追加任务从未使用的序号继续。每个新子 Issue 正文写父 Issue 链接和草稿标识；创建成功后同时保留 number、html_url 和 REST `id`。
3. 每个子任务创建后立刻挂成该父 Issue 的 sub-issue，再按实际依赖写 `blocked_by`。检查自依赖和循环，不把列表顺序当成依赖。`sub_issues_summary.total` 与子任务数不一致，或依赖未核实时，不实施受影响的任务。
4. 恢复已有需求时，若父 Issue 已有子任务但 `sub_issues_summary.total` 为 0，补挂 sub-issue，不要只改正文。
5. sub-issue 或 blocked_by API 不可用时停下说明缺什么；可以在正文保留链接方便阅读，但必须写明进度圈和原生依赖都没有建上。不要把链接回退当成发布完成。
6. 原生关系以 API 为准，正文的前置交付物说明保留。发现正文与原生关系冲突时先核实并修正。

GitHub 进度圈把所有 closed 子 Issue 算进 `completed`，`not_planned` 也会增加数字。调度和验收仍看关闭原因，取消项不能当完成。

发布前在授权范围内创建缺少的 JN 标签，定义见下节；不要求看板。业务正文更新前重新读取，保留用户的补充；只改本次负责的小节。发现他人正在修改同一段时先协调，不覆盖整份旧快照。

## 部分失败与重试

创建超时不等于没有创建。先查当前仓库中已发布的父 Issue、其子任务和带父链接的任务，结合标题、草稿标识和正文确认结果。已有对象就补关系、链接或缺失内容；不能盲目重发创建请求。无法消除重复疑问时报告具体候选，暂停有歧义的写入。

逐项保存真实返回的 Issue 链接。首次父 Issue 的返回结果丢失时，通过完整草稿内容和近期创建记录定位；多个匹配不自行合并或删除。

更新/关闭失败时重读远端确认实际状态。远端写入未成功就报告未同步，不宣称完成，不在本地建立替代进度库。

## 本地发布和关系

每个打开需求一个目录，不创建汇总数据库：

```text
.jnative/task/<feature-slug>/prd.md
.jnative/task/<feature-slug>/01-<task-slug>.md
.jnative/task/<feature-slug>/02-<task-slug>.md
```

`prd.md` 使用 RFC 正文，并在最前面添加：

```yaml
---
jn_type: prd
jn_stage: clarifying
jn_state: open
jn_closed_reason: null
---
```

任务文件使用子任务模板，并添加相同 frontmatter，`jn_type: task`。`jn_stage` 取 GitHub 阶段标签去掉 `jn:` 后的值；`jn_state` 只取 `open` 或 `closed`；关闭时 `jn_closed_reason` 取 `completed` 或 `not_planned`，打开时为 `null`。

父 PRD 增加「子任务」小节，使用相对链接列出所有任务，不复制任务状态。任务的父需求和前置任务也使用相对链接。编号按依赖顺序从 `01` 递增，已使用编号不复用。执行证据按时间追加在任务文件的「执行记录」小节；本地没有评论或 label 的第二份表示。

写入前按目录、标题和草稿标识查重。文件已存在时先读取并只更新负责的小节；不得覆盖用户补充。一次操作写到一半时，重新扫描目录并补缺失文件或链接，不重复创建带新编号的任务。

## 状态

GitHub 的完成与取消由 Issue 的 open/closed 和关闭原因决定；类型与打开时的阶段用 label 管理。本地使用等价 frontmatter，关闭时将 `jn_stage` 设为 `null`。两种 tracker 使用同一组阶段和关闭原因。

### 标签定义

每条 JN 记录恰好一个类型；打开时恰好一个阶段，关闭后清除阶段并保留类型。GitHub 的非 JN 标签不由日常流程删除。

| Label | 颜色 | 含义 |
|---|---|---|
| `jn:prd` | `5319E7` | RFC 父需求 |
| `jn:task` | `1D76DB` | 可独立实施和验收的任务 |
| `jn:clarifying` | `D4C5F9` | 需求、方案或任务定义仍需澄清 |
| `jn:awaiting-confirmation` | `FBCA04` | 内容已整理，等待用户确认 |
| `jn:ready` | `0E8A16` | 已确认且前置条件满足，可以开始 |
| `jn:in-progress` | `0075CA` | 正在实施 |
| `jn:blocked` | `D73A4A` | 被依赖、环境或其他问题阻塞 |
| `jn:review` | `F9D0C4` | 实施已完成，等待检查或整体验收 |

创建时按内容完整性、确认记录及前置条件选阶段；父需求未确认时，其已拆好的子任务也用 `jn:awaiting-confirmation`。`jn:ready` 不代表用户授权，启动前仍核对确认和产物。

开始实施切换为 `jn:in-progress`，实现完成进入检查时切换为 `jn:review`；检查失败且能继续修复时回到 `jn:in-progress`，无法推进才用 `jn:blocked`。阻塞消除后重新检查授权与依赖，再进入 ready、实施或 review，不机械恢复旧标签。

父记录未确认时按澄清/待确认标记；已确认后，有正在实施的子任务就为 `jn:in-progress`；已有部分交付且仍有可推进任务也保持该阶段；尚未开始但有可执行任务则为 `jn:ready`。所有剩余任务无法推进或整体验收受环境阻塞时才标 `jn:blocked`。剩余工作仅需检查或整体验收时标 `jn:review`。一个子任务阻塞不自动阻塞整个父需求。

阶段是方便筛选的当前记录，依赖仍以原生关系（或明确的链接回退）为准。发现阶段与确认、依赖或实际执行不符时核实并修正；多个或缺失阶段不靠标签顺序猜测。只读查看时报告不一致，不修改。

阶段切换仅移除这六个已定义阶段标签，再添加新阶段，保留类型和其他标签。创建同名标签前先检查是否存在，语义不符先核对，不覆盖他人的约定。删除旧标签仅在用户明确要求清理时执行，不能作为每个项目启用 JN 的默认动作。

打开的子任务正文「执行信息」只保存执行者/会话、工作位置、更新时间和阻塞原因。GitHub assignee 表示实际负责人，不用负责人标签；会话标识不冒充 GitHub 用户。关闭时清除过期执行信息，不增加 done/cancelled 标签或正文完成字段。

- 验收和检查通过、证据已回写后，以 completed 关闭子任务。
- 用户取消时，以 not_planned 关闭，执行记录写明决定和影响；不得当成完成。
- 关闭原因缺失或不明确时读取关闭记录，无法确定就列为待核实，不能仅因 closed 满足依赖。
- 重新打开的任务刷新执行信息，按当前确认、依赖和检查结果恢复一个阶段标签，并在涉及下游时重新检查依赖。
- 父记录只有整体验收通过才能以 completed 关闭。用户放弃整个需求则记录决定，以 not_planned 关闭，不伪造验收。
- 父记录关闭或重开后，按「轻量本地视图与归档」更新索引；local 记录同时移动到对应的日期归档目录或当前任务目录。

确认与完成分开。父记录的「JN 确认记录」只说明接受了什么范围，不承担工作进度。保留旧确认，范围变更时追加新的范围与依据，不能把旧确认套到新增需求上。

## 旧需求迁移

只在用户明确要求时迁移指定的 `.jnative/<feature>/`，包括用户明确点名的历史目录：

1. 读取 intent、plan、todo、specs 及相关证据，先检查配置的 tracker 是否已存在迁移后的父记录。
2. 通过 `jn-intent` 合成 RFC、图示，并使用 `renhua`；通过 `jn-plan` 整理任务。
3. 旧记录中的明确确认可按原人、原日期和范围迁入，不能虚构新的确认。目标或范围改变的部分另行确认。
4. 迁入状态前核对证据。旧文件写“完成”但缺少可核实结果时保留打开并说明待验证；明确取消的任务按取消处理。
5. 在父记录注明原目录及迁移来源。发布按同样的重试规则执行，防止重复。
6. 原文件保留为历史，不回写任务进度。后续从新父记录恢复；除非用户明确要求，不自动移动旧文件。明确归档时放入 `.jnative/archive/YYYY-MM-DD/<feature-slug>/` 并修复相对链接，不移动共享调研和术语表。
