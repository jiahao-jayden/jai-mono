# Spec 01 · Coding Agent 配置系统

> 状态：已决  
> 所属：`@jai/coding`  
> 后续：Provider 配置、Permission 规则、Session、Agent Skills

## 1. 目标

为 Coding Agent 提供统一的配置基础设施，负责：

- 用户级、项目共享级、项目本地级配置；
- 严格 schema 校验与显式版本迁移；
- 按字段定义的合并策略和来源追踪；
- workspace trust；
- 显式环境变量覆盖；
- 原子写入、外部变更监听与结构化诊断。

首版只实现配置框架，不在本篇定义 Provider、Permission、Session 或 Skills 的业务字段。

## 2. 数据边界

声明配置、运行状态、会话、凭据和缓存是不同实体：

- settings 文件只保存声明配置；
- workspace trust、最近项目等运行状态保存在 `~/.jai` 的专用状态存储中；
- session 与 transcript 使用独立存储和 retention；
- API Key 等凭据由系统安全存储或后续 Credential Provider 持有；
- 项目 settings 只能引用凭据，不得保存 secret value。

本篇不定义后三类数据的具体文件布局。

## 3. Scope 与优先级

### 3.1 文件

| Scope | 路径 | 用途 |
| --- | --- | --- |
| User | `~/.jai/settings.json` | 跨 workspace 的用户默认值 |
| Project shared | `<workspace>/.jai/settings.json` | 可提交、可审查的团队配置 |
| Project local | `<workspace>/.jai/settings.local.json` | 不提交的个人项目覆盖 |

缺失文件表示该 scope 没有配置，不是错误。已有文件必须是严格 JSON，且顶层包含 `$schema` 和 `schemaVersion`。

`settings.local.json` 应加入项目的 Git ignore。配置系统可以诊断其被跟踪的风险，但不得静默修改用户的 Git 配置。

### 3.2 环境变量

环境变量是最高优先级的只读 scope：

```text
Environment > Project local > Project shared > User
```

不提供任意字段到环境变量的自动映射。只有 schema 明确声明的 `JAI_*` 变量可以覆盖对应字段；解析、类型转换与校验规则由该字段同时声明。

### 3.3 Workspace trust

项目 shared/local 配置在 workspace 未被信任时采用限制优先语义：

- 收紧能力的配置立即生效；
- 扩大能力的配置暂不生效；
- trust 通过后才重新计算完整配置。

字段定义必须声明其 trust/安全语义，不能仅凭值的新旧关系通用推断。

## 4. Schema 与校验

- 使用严格 JSON，不支持注释或尾逗号；
- `$schema` 必填，用于编辑器补全；其稳定发布 URL 在 schema artifact 发布时确定；
- `schemaVersion` 必填，是运行时迁移的权威版本；
- runtime validator 与发布的 JSON Schema 必须由同一类型来源生成；
- schema 默认拒绝未知字段；
- runtime 校验不依赖网络或远程 schema 可用性；
- 每个 schema artifact 固定到 Jai release，不使用可漂移的 latest schema 作为唯一契约。

最小合法文件：

```json
{
  "$schema": "<该 Jai release 的固定 schema URL>",
  "schemaVersion": 1
}
```

业务 spec 增加字段时，必须同时提供：

- runtime 类型和校验；
- merge policy；
- trust/安全语义；
- 可选的环境变量映射；
- schemaVersion 迁移。

## 5. 合并模型

不提供一个适用于所有字段的通用 deep merge。每个字段必须声明以下策略之一：

- `replace`：最高优先级有效值覆盖；
- `deepMerge`：对象逐字段合并；
- `appendUnique`：列表按稳定 key 拼接去重；
- `restrictOnly`：低信任来源只能收紧；
- `denyUnion`：限制规则取并集；
- 业务 spec 定义的其他受限策略。

解析结果必须携带 provenance。调用方至少能查询：

```ts
interface ConfigProvenance {
  path: string;
  source: "environment" | "project-local" | "project-shared" | "user" | "default";
  mergePolicy: string;
  sourceFile?: string;
}
```

provenance 用于设置 UI、诊断和权限解释，不能只返回最终值。

## 6. `@jai/coding` API 边界

配置系统由 `@jai/coding` 拥有。Electron 只提供 workspace/home 路径、系统凭据适配和 UI，不重复实现配置规则。

公开能力包括：

- 解析三个文件 scope 与显式环境变量；
- 加载、校验、迁移并返回 typed snapshot；
- 查询字段 provenance 和诊断；
- 按指定可写 scope 更新配置；
- 监听文件变化并发布新 snapshot；
- workspace trust 改变后重新求值。

写 API 必须：

- 指定 `user`、`project-shared` 或 `project-local`，不能写 environment；
- 使用 revision/hash 做 optimistic concurrency check；
- 在同目录写临时文件并原子 rename；
- 格式化为稳定 JSON；
- 写入前后都执行 runtime 校验；
- 不把 resolved config 反向写回任一 scope。

## 7. Reload 语义

应用运行期间监听三个 settings 文件：

1. 文件变化后完整解析、迁移、校验和合并；
2. 成功时原子发布新的 immutable typed snapshot；
3. 失败时保留最后一个有效 snapshot 供诊断展示；
4. 失败状态下禁止创建新的 Agent run，避免静默使用已失效配置；
5. 对正在运行的 Agent 如何中止或降权，由 runtime spec 决定。

配置写入与 watcher 必须通过 revision 去重，不能因自身写入产生重复事件循环。

## 8. 迁移

- 每个文件独立按 `schemaVersion` 迁移；
- migration 必须有序、幂等并可针对历史 fixture 测试；
- 写回采用临时文件、fsync、原子 rename；
- 迁移前创建受 retention 控制的备份；
- 未知的更高版本必须拒绝加载和写回；
- 迁移失败不得覆盖原文件；
- backup 不得复制 secret，因为 settings 本身禁止 secret value。

## 9. 错误策略

配置错误统一使用 `@jai/common` 的 `CodedError`，由配置模块用 `defineCodedError("coding_config", reasons)` 维护本地 reason 集。

首版 reason 至少覆盖：

- `parse_failed`
- `validation_failed`
- `unsupported_version`
- `migration_failed`
- `write_conflict`
- `write_failed`
- `watch_failed`

错误 `data` 只包含可序列化、经过筛选的诊断信息，例如 scope、文件路径、字段路径、期望版本和实际版本。跨 Electron 进程边界使用 `toErrorEnvelope()`，不得传递 stack、cause 或原始底层错误。

任一已存在 scope 解析、校验或迁移失败时，配置加载 fail closed：桌面应用仍可打开配置修复界面，但 Agent 不得启动。不能静默跳过整个 scope，也不能过滤无效字段后继续。

## 10. 首版验收

- 三个 scope 的缺失、覆盖和 provenance 有测试；
- 每种 merge policy 有独立测试；
- 未信任 workspace 只能应用限制性项目配置；
- 显式 `JAI_*` 映射优先级最高，未声明变量不影响配置；
- 无效 JSON、未知字段、旧版本迁移、未来版本均有测试；
- 并发写入可检测冲突，原文件不会被破坏；
- watcher 只发布完整有效 snapshot；
- 所有主动错误符合 Jai 的 CodedError 规则。
