# OpenCode 自动权限审批调研

> 调研日期：2026-08-11  
> OpenCode 源码：`dev`，提交 [`d041eee55c4b669f583fcbe0eb73e78d53393ae8`](https://github.com/anomalyco/opencode/commit/d041eee55c4b669f583fcbe0eb73e78d53393ae8)  
> 范围：官方文档、官方源码、官方测试；不依赖第三方实现说明。

## 结论

OpenCode 的“自动权限审批”不是把所有权限规则改成 `allow`，而是把客户端的人工回复自动化：

```text
工具执行前调用 permission.ask / ctx.ask
  → 服务端按规则得到 allow / ask / deny
  → allow：继续执行
  → deny：直接失败，不生成待审批请求
  → ask：发布 permission.asked，挂起工具调用
  → --auto 客户端收到事件后回复 once
  → 当前工具调用恢复执行
```

因此，`--auto` 只能自动处理已经进入 `ask` 的请求，不能绕过显式 `deny`。CLI 的实现就是监听 `permission.asked`，然后调用 `client.permission.reply({ requestID, reply: "once" })`。[CLI 自动回复](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/opencode/src/cli/cmd/run.ts#L3579-L3592)

## 1. 权限求值与自动审批是两个层次

### 规则层：决定是否需要审批

OpenCode V1 使用有序的三元规则：

```ts
type Rule = {
  permission: string
  pattern: string
  action: "allow" | "ask" | "deny"
}
```

规则同时匹配权限名和资源 pattern；所有规则展平后使用最后一条匹配规则，未命中时默认 `ask`。因此规则顺序就是优先级，不是固定的 `deny > ask > allow`。[V1 Permission evaluator](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/opencode/src/permission/index.ts)

典型配置：

```json
{
  "permission": {
    "*": "ask",
    "bash": {
      "*": "ask",
      "git status *": "allow",
      "rm *": "deny"
    },
    "edit": {
      "*.md": "allow"
    }
  }
}
```

### 交互层：决定如何处理 `ask`

进入 `ask` 后，服务端创建 pending request、发布事件并等待回复。回复有三种：

- `once`：只批准当前请求；
- `always`：批准当前请求，并记住工具提供的可复用资源 pattern；
- `reject`：拒绝当前请求。

V1 的 pending 请求包含 `sessionID`、实际 `patterns`、用于 `always` 的 `always` patterns，以及供 UI 展示的 metadata。[V1 permission schema](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/schema/src/v1/permission.ts)

## 2. 多资源请求如何聚合

一次工具调用可能同时需要多个资源授权。OpenCode 逐个求值：

1. 任一资源为 `deny`，整次调用立即拒绝；
2. 没有 `deny`，但至少一个资源为 `ask`，整次调用进入 pending；
3. 所有资源均为 `allow`，直接执行。

这保证了“部分资源已允许”不能让整条工具调用提前执行。Shell 复合命令也应先拆成多个命令节点，再按这个聚合规则判断。[V1 permission 状态机与回复](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/opencode/src/permission/index.ts)

## 3. `--auto` 的确切行为

CLI 参数的语义是“自动批准没有被显式拒绝的权限”。运行时的核心逻辑等价于：

```ts
if (event.type === "permission.asked") {
  if (permission.sessionID !== sessionID) continue

  if (auto) {
    await client.permission.reply({
      requestID: permission.id,
      reply: "once",
    })
  }
}
```

这里有三个重要性质：

1. **自动批准发生在客户端事件处理器，而不是 Permission evaluator 内部。** 服务端仍然产生完整的 pending/reply 生命周期。
2. **自动批准只发送 `once`。** 它不会新增永久 `allow` 规则，也不会改变后续调用的求值结果。
3. **显式 `deny` 不会产生可批准的正常 pending。** 所以自动模式没有机会覆盖它。[CLI `--auto` 实现](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/opencode/src/cli/cmd/run.ts)

非自动的非交互运行模式会对 pending 请求回复 `reject`；这说明自动审批本质上是客户端对同一套 Permission API 的一种策略，而不是另一套执行路径。[CLI run permission handling](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/opencode/src/cli/cmd/run.ts)

## 4. `always` 与自动审批不能混为一谈

`--auto` 使用 `once`，所以每个请求都只获得一次批准；用户在 UI 中选择 `always` 才会产生 remembered approval。

当前 OpenCode 源码存在 V1/V2 并行：

| 能力 | Permission V1 | Permission V2 |
| --- | --- | --- |
| 规则模型 | `permission + pattern + action` | `action + resource + effect` |
| 本次资源 | `patterns[]` | `resources[]` |
| 可记住的资源 | `always[]` | `save[]` |
| `always` 存储 | Instance 进程内存 | 项目级 SQLite permission 表 |
| 工具阻塞入口 | `ask()` | `assert()` |
| 无匹配默认值 | `ask` | `ask` |

V1 的 `always` 会把规则追加到 Instance 内存，并释放同一 session 中已经被新规则覆盖的 pending 请求；实例销毁后 remembered approval 消失。V2 将 `save[]` 写入项目级持久化存储，并在保存后重新评估当前 Location 的 pending 请求。[V1 Permission 状态](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/opencode/src/permission/index.ts) · [V2 Permission service](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/core/src/permission.ts)

V2 还把 configured deny 放在 saved allow 之前检查：记住的 allow 不能抵消用户明确配置的 deny。[V2 权限实现](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/core/src/permission.ts)

## 5. 工具、Session、Agent 的边界

权限资源由具体工具在参数校验和规范化之后构造，Permission 服务只负责匹配和生命周期。典型映射是：

- `read`：实际文件路径；
- `edit`：写入/编辑目标和 diff 上下文；
- `bash` / `shell`：命令或命令节点；
- `task` / `subagent`：目标 agent 标识；
- `external_directory`：工作区外的目录访问。

每个请求带有 `sessionID`。CLI 自动回复前会检查该请求是否属于当前 session，避免一个 session 的自动模式误批准另一个 session 的请求。[V1 permission schema](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/schema/src/v1/permission.ts) · [CLI session 过滤](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/opencode/src/cli/cmd/run.ts#L3579-L3592)

子 Agent 不会自动继承父 Agent 的全部 allow；父级 deny 和外部目录约束继续生效，具体能力由子 Agent 自己的 ruleset 决定。[Subagent permission assembly](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/opencode/src/agent/subagent-permissions.ts)

## 6. Shell 风险边界

V1 Shell 会在执行前解析 Bash/PowerShell，拆出复合命令和嵌套命令，并对可识别的外部目录发起独立的 `external_directory` 请求。`always` pattern 通过命令 arity 生成可复用的稳定前缀，而不是默认记住完整 Bash 或任意 `*`。[V1 Shell implementation](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/opencode/src/tool/shell.ts) · [Bash arity](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/opencode/src/permission/arity.ts)

这套 Permission 仍然是应用层闸门，不是 OS sandbox：批准后启动的 shell 仍使用宿主用户的文件、进程和网络权限。动态脚本和任意程序内部访问不能仅靠 pattern 匹配完整约束。[OpenCode 权限文档](https://opencode.ai/v2/docs/permissions)

## 7. 对 Jai 的直接落地建议

如果目标是实现 OpenCode 风格的自动审批，建议保留以下最小闭环：

```text
tool.execute
  → permission.check
  → allow：继续
  → deny：返回结构化拒绝错误
  → ask：创建 pending + 发布事件 + 等待
  → auto controller：按 session 过滤后 reply once
```

具体建议：

1. **自动模式只处理 `ask`。** 不在 resolver 外加一个“全局 allow”分支；显式 deny 和不可覆盖的风险层必须先结束求值。
2. **把 `once`、`always`、`reject` 建模为一次性协议决策。** `requestId` 必须单次消费，过期、重复或跨 session 响应都拒绝。
3. **分离本次资源和可记住资源。** `patterns/resources` 描述本次真实访问；`always/save` 只描述经过工具语义压缩后的安全复用范围。
4. **Shell 先解析再授权。** 复合命令逐节点求权；`always` 使用稳定前缀；无法安全解析时回到 `ask`。
5. **持久化 remembered approval 时采用 V2 的优先级。** saved allow 只能补充 allow，不能覆盖 configured deny；保存后重新评估同一 workspace/location 的 pending。
6. **不要把 Permission 当 sandbox。** 需要限制获准命令的文件、网络或进程能力时，仍需 OS sandbox、容器或 syscall 级隔离。

本仓库已有的 [OpenCode-Compatible Permission System](../../../docs/build-coding-agent/09-opencode-compatible-permission-system.md) 已吸收其中大部分结构，并额外增加了不可覆盖的危险 Bash 层；本调研的关键补充是：`--auto` 应实现为事件侧 `reply once`，而不是让普通 resolver 直接返回 `allow`。

## 官方参考

- [OpenCode V1 权限文档](https://dev.opencode.ai/docs/permissions/)
- [OpenCode V2 权限文档](https://opencode.ai/v2/docs/permissions)
- [V1 Permission service](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/opencode/src/permission/index.ts)
- [V1 CLI auto approval](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/opencode/src/cli/cmd/run.ts)
- [V1 Permission schema](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/schema/src/v1/permission.ts)
- [V2 Permission service](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/core/src/permission.ts)
