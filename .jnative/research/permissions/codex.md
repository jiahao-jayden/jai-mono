# Codex 权限系统调研

核验日期：2026-09-19。目标实现是 OpenAI 官方开源仓库 [`openai/codex`](https://github.com/openai/codex)，不是产品文档的替代实现；本笔记固定源码 commit `78245b47af2a7aafcabe025828ceecca69db4df1`，对应本次核验时的 `main`。固定 SHA 是为了避免后续源码变化混入结论。官方产品文档只用于说明公开语义，源码结论均链接到该 SHA。

## 结论

1. Codex 把权限拆成多个正交层：命名 permission profile 负责文件系统/网络能力，`AskForApproval` 负责能否把风险交给审批者，exec policy 负责按命令判定 allow/prompt/forbidden，sandbox/backend 负责最终执行约束。单独改变其中一层不能等价替换其他层。[源码证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/exec_policy.rs#L394-L454)

2. 默认权限取决于 workspace trust：可信或明确不可信的项目默认使用 `:workspace`，其他情况使用 `:read-only`；Windows sandbox disabled 时会降级为只读默认值。这个默认值是项目状态与平台能力的函数，不是固定的全局常量。[源码证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/config/permissions.rs#L51-L62)

3. `OnRequest` 的核心语义是“在受限 sandbox 中让 sandbox 执行约束承担低风险命令的保护”，不是每条命令都弹窗；`UnlessTrusted` 则对未被 exec policy 明确允许的命令要求审批；`Never` 禁止把 prompt 暴露给用户并将需要审批的命令转为 forbidden。[源码证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/exec_policy.rs#L793-L838)

4. 审批不是只有“允许/拒绝”：至少区分本次 `Accept`、session cache 的 `AcceptForSession`、写入 exec policy 的 `AcceptWithExecpolicyAmendment`、写入网络规则的 `ApplyNetworkPolicyAmendment`、继续运行的 `Decline` 和立即打断 turn 的 `Cancel`。[协议证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L63-L85)

5. session 授权是内存态、按 canonical command/cwd/tty/sandbox/additional permissions/environment 组成的 key 缓存；它不等于持久 policy。持久授权需要显式的 execpolicy amendment 或 network policy amendment。[源码证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/sandboxing.rs#L65-L116)

6. 文件系统能力支持 read/write/deny、绝对路径、glob、特殊路径和 workspace roots；关键安全约束是：存在 deny-read 时不能绕过 sandbox，因为绕过会把被拒绝的读取重新放开。[源码证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/sandboxing.rs#L239-L296)

7. 网络能力不是简单的 boolean。profile 的 `network.enabled` 控制 sandbox network access，managed proxy 配置另有 feature/config 入口；当请求触发网络阻断时，审批可以只对 host 写入 allow/deny 的持久规则。[源码证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/config/permissions.rs#L123-L135)

8. 审批触发点由 orchestrator 统一收口：先计算 environment、workspace roots、permission profile、exec approval requirement；`Forbidden` 直接失败，`NeedsApproval` 进入 reviewer，`Skip` 才进入执行阶段。工具 runtime 不能自行绕过这条主路径。[源码证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/orchestrator.rs#L131-L223)

9. 审批 reviewer 有明确优先级：permission hook 优先，其次是 strict auto-review/Guardian，最后才是用户；取消、超时、拒绝在进入 tool result 时被投影为不同的失败语义。[源码证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/approvals.rs#L473-L547)

10. 非交互 `codex exec` 默认把 approval policy 设为 `Never`；因此 headless 模式不会等待用户审批，命令失败会直接回到模型/调用方。它仍可通过显式配置选择 `AutoReview` 等 reviewer，不能假设所有 headless 执行都完全无审批逻辑。[源码证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/exec/src/lib.rs#L563-L590)

11. 非交互入口默认还要求位于 Git 项目中；只有显式 `--skip-git-repo-check` 或危险 bypass 才跳过该检查。这是 trust 边界的一部分，而不是 sandbox 本身。[源码证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/exec/src/lib.rs#L962-L970)

12. app-server 的 `process/spawn` 是一个明确的能力边界：它在 app-server 所在 host 上启动 standalone process，注释明确写着“不带 Codex sandbox”；因此它不能被当作带 permission profile 的 agent tool 入口复用。[协议证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server-protocol/src/protocol/v2/process.rs#L19-L24)

13. RPC/DTO 边界使用显式结构体和转换：`RequestPermissionProfile` 只允许 network/file_system 两类能力，`deny_unknown_fields` 拒绝未声明字段，路径从外部字符串转换为内部 PathUri/AbsolutePathBuf；这比把内部 permission object 原样跨进程传递更安全。[协议证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server-protocol/src/protocol/v2/permissions.rs#L215-L245)

14. resume 会恢复持久化的 approval policy，但显式 resume override 优先；permission profile 也会在 cold resume 时按当前配置重新解析，若 profile 已删除则回落到当前 configured default。恢复的是 durable thread settings，不是旧进程的 session approval cache。[测试证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server/tests/suite/v2/thread_resume.rs#L1049-L1075)

15. `request_permissions` 把临时增权的 scope 显式建模为 `Turn` 或 `Session`；它只描述额外 network/file_system 权限，不能直接表达任意命令允许。审批 response 还可要求本 turn 后续命令进入 strict auto-review。[协议证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/protocol/src/request_permissions.rs#L10-L23)

16. workspace trust 是风险提示和配置启用边界：未信任目录的 config、hooks、exec policies 会被禁用，但工具仍遵循 permission settings；已有 trusted task 继续打开时可能保留历史 settings/hooks，因此 UI 明确建议需要 restricted settings 时新建 task。[源码证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/tui/src/onboarding/trust_directory.rs#L79-L93)

17. 测试覆盖不是只测枚举映射：包括 approval policy、sandbox filesystem/network、exec policy、RPC process lifecycle、approval DTO、resume policy/profile precedence 及 sandbox denied-read 行为；但部分 sandbox 测试会在宿主无法施加 Linux sandbox 时 skip，不能把“测试通过”解释为所有平台都实际执行了同一隔离后端。[测试证据](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/exec/tests/suite/sandbox.rs#L97-L129)

## 权限主体与能力

### 1. Permission profile 是能力集合

**主张：** 内置 profile 至少有 `:read-only`、`:workspace`、`:danger-full-access`；其中 workspace profile 的 network 可以受限或启用，danger-full-access 对应关闭 permission profile sandbox。源码还支持 named profile 继承和 workspace roots。

[`permissions.rs#L46-L99`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/config/permissions.rs#L46-L99)

```rust
pub(crate) const BUILT_IN_READ_ONLY_PROFILE: &str = BUILT_IN_PERMISSION_PROFILE_READ_ONLY;
pub(crate) const BUILT_IN_WORKSPACE_PROFILE: &str = BUILT_IN_PERMISSION_PROFILE_WORKSPACE;
pub(crate) const BUILT_IN_DANGER_FULL_ACCESS_PROFILE: &str =
    BUILT_IN_PERMISSION_PROFILE_DANGER_FULL_ACCESS;
...
BUILT_IN_WORKSPACE_PROFILE => Some(match workspace_write {
    Some(WorkspaceWriteSettings { network_access, .. }) => PermissionProfile::workspace_write_with(
        &[],
        if *network_access { NetworkSandboxPolicy::Enabled }
        else { NetworkSandboxPolicy::Restricted },
...
BUILT_IN_DANGER_FULL_ACCESS_PROFILE => Some(PermissionProfile::Disabled),
```

**成立条件：** 这里的 profile 是 Codex permission model；外部 executor 或 app-server 的 standalone `process/spawn` 不自动继承它。

### 2. 文件系统与网络是不同能力轴

**主张：** RPC 的 additional permission profile 把 network 和 file_system 分开建模，文件系统还保留 read/write legacy 字段，同时支持 entries 与 glob depth。

[`permissions.rs#L56-L70`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server-protocol/src/protocol/v2/permissions.rs#L56-L70)

```rust
pub struct AdditionalFileSystemPermissions {
    /// This will be removed in favor of `entries`.
    pub read: Option<Vec<LegacyAppPathString>>,
    /// This will be removed in favor of `entries`.
    pub write: Option<Vec<LegacyAppPathString>>,
    pub glob_scan_max_depth: Option<NonZeroUsize>,
    pub entries: Option<Vec<FileSystemSandboxEntry>>,
}
...
pub struct AdditionalNetworkPermissions {
    pub enabled: Option<bool>,
}
```

**不成立条件：** `network.enabled = true` 不等于对所有 host 的无限制网络；managed network proxy 仍可按 host/protocol 决策。

## 默认策略与 workspace trust

### 3. 默认 profile 取决于 trust 和平台

**主张：** trusted/untrusted project 会选 workspace profile，其他状态选 read-only；Windows sandbox disabled 时即使 project status 满足也不选 workspace。

[`permissions.rs#L51-L62`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/config/permissions.rs#L51-L62)

```rust
pub(crate) fn default_builtin_permission_profile_name(
    active_project: &ProjectConfig,
    windows_sandbox_level: WindowsSandboxLevel,
) -> &'static str {
    if (active_project.is_trusted() || active_project.is_untrusted())
        && !(cfg!(target_os = "windows") && windows_sandbox_level == WindowsSandboxLevel::Disabled)
    {
        BUILT_IN_WORKSPACE_PROFILE
    } else {
        BUILT_IN_READ_ONLY_PROFILE
    }
}
```

**主张：** trust UI 明确告知 folder settings 可以自动运行代码，且 trust decision 会保存。

[`trust_directory.rs#L79-L93`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/tui/src/onboarding/trust_directory.rs#L79-L93)

```rust
if self.restricted {
    "Config, hooks, and exec policies from untrusted folders stay disabled. \
     Trusted project folders can still contribute settings. Skills still load, \
     and tools follow your permission settings. Opening will not change saved trust."
} else {
    "Trust this folder? Codex can read, edit, and run files here, subject to \
     your permission settings. Folder settings can run code automatically, \
     even without a model request. Continue only if you trust these files. \
     Your trust decision will be saved."
}
```

**边界：** 一个已有的 trusted task 可能继续持有历史 settings/hooks；切换到 restricted settings 要新建 task，而不是假设重新打开会清空旧状态。

## 审批触发与命令约束

### 4. exec policy 先于用户审批

**主张：** command 会先经 policy evaluation，结果为 forbidden、prompt 或 allow；policy prompt 还会根据 `AskForApproval` 的 granular flags 决定是 forbidden 还是可以进入审批。

[`exec_policy.rs#L394-L454`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/exec_policy.rs#L394-L454)

```rust
match evaluation.decision {
    Decision::Forbidden => ExecApprovalRequirement::Forbidden { reason: ... },
    Decision::Prompt => {
        let prompt_is_rule = evaluation.matched_rules.iter().any(|rule_match| {
            is_policy_match(rule_match) && rule_match.decision() == Decision::Prompt
        });
        match prompt_is_rejected_by_policy(approval_policy, prompt_is_rule) {
            Some(reason) if prompt_is_rule => ExecApprovalRequirement::Forbidden { reason: ... },
            Some(reason) => ExecApprovalRequirement::Forbidden { reason: ... },
            None => ExecApprovalRequirement::NeedsApproval { reason: ... },
        }
    }
    Decision::Allow => ExecApprovalRequirement::Skip { bypass_sandbox: ... },
}
```

### 5. 危险命令、无 sandbox 与 `Never` 的交互

**主张：** dangerous command 或没有有效 sandbox protection 时不会无审批运行；`Never` 下直接 forbidden，其他可交互策略才 prompt。

[`exec_policy.rs#L793-L818`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/exec_policy.rs#L793-L818)

```rust
if dangerous_command_match.is_some() || windows_managed_fs_restrictions_without_sandbox_backend {
    return match approval_policy {
        AskForApproval::Never => Decision::Forbidden,
        AskForApproval::OnRequest
        | AskForApproval::UnlessTrusted
        | AskForApproval::Granular(_) => Decision::Prompt,
    };
}
```

**纠正：** `OnRequest` 不是全局 allow，也不是全局 prompt；在 restricted sandbox 下，非 escalation 的普通命令由 sandbox 直接保护并 allow，要求绕过 sandbox 时才 prompt。[`exec_policy.rs#L820-L838`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/exec_policy.rs#L820-L838)

### 6. 路径、deny-read 与 escalation

**主张：** `RequireEscalated` 通常意味着绕过 sandbox，但当 profile 含 deny-read 时会被改回默认 sandboxed attempt，以保留 deny-read 约束。

[`sandboxing.rs#L270-L296`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/sandboxing.rs#L270-L296)

```rust
pub(crate) fn unsandboxed_execution_allowed(
    file_system_sandbox_policy: &FileSystemSandboxPolicy,
) -> bool {
    !file_system_sandbox_policy.has_denied_read_restrictions()
}

pub(crate) fn sandbox_permissions_preserving_denied_reads(
    sandbox_permissions: SandboxPermissions,
    file_system_sandbox_policy: &FileSystemSandboxPolicy,
) -> SandboxPermissions {
    if sandbox_permissions.requires_escalated_permissions()
        && !unsandboxed_execution_allowed(file_system_sandbox_policy)
    {
        SandboxPermissions::UseDefault
    } else {
        sandbox_permissions
    }
}
```

**不成立条件：** “用户批准 escalation = 获得 full disk”不成立；deny-read profile 下批准也不能丢掉 deny-read sandbox。

### 7. approval action 携带的约束上下文

**主张：** command approval DTO 同时携带 environment、cwd、additional permissions、network context、execpolicy amendment 和 available decisions，客户端不能只依据 command 字符串做决策。

[`approvals.rs#L270-L340`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/protocol/src/approvals.rs#L270-L340)

```rust
pub struct ExecApprovalRequestEvent {
    pub kind: ExecApprovalKind,
    pub call_id: String,
    pub approval_id: Option<String>,
    pub turn_id: String,
    pub environment_id: Option<String>,
    pub started_at_ms: i64,
    pub command: Vec<String>,
    pub cwd: LegacyAppPathString,
    pub reason: Option<String>,
    pub network_approval_context: Option<NetworkApprovalContext>,
    pub proposed_execpolicy_amendment: Option<ExecPolicyAmendment>,
    pub additional_permissions: Option<AdditionalPermissionProfile>,
    pub available_decisions: Option<Vec<ReviewDecision>>,
}
```

## 一次性、持久授权与非交互

### 8. 一次性与 session 授权

**主张：** `ApprovalStore` 仅缓存 `ApprovedForSession`；缓存 key 是序列化后的结构化 key，approval keys 为空时不会错误命中缓存。

[`sandboxing.rs#L40-L116`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/sandboxing.rs#L40-L116)

```rust
pub(crate) struct ApprovalStore {
    // Store serialized keys for generic caching across requests.
    map: HashMap<String, ReviewDecision>,
}
...
if keys.is_empty() {
    return fetch().await;
}
...
.all(|key| matches!(store.get(key), Some(ReviewDecision::ApprovedForSession)))
...
if matches!(decision, ReviewDecision::ApprovedForSession) {
    for key in keys {
        store.put(key, ReviewDecision::ApprovedForSession);
    }
}
```

**主张：** RPC 的 `request_permissions` 另有 turn/session grant scope；这是权限请求的临时授予范围，不是把 command approval cache 持久化。

[`request_permissions.rs#L10-L23`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/protocol/src/request_permissions.rs#L10-L23)

```rust
pub enum PermissionGrantScope {
    #[default]
    Turn,
    Session,
}

pub struct RequestPermissionProfile {
    pub network: Option<NetworkPermissions>,
    pub file_system: Option<FileSystemPermissions>,
}
```

### 9. 持久授权是 policy amendment

**主张：** exec policy amendment 是按 token prefix 写入的 allow rule；network amendment 是按 host 写入 allow/deny 规则，两者都与 session cache 分离。

[`approvals.rs#L34-L44`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/protocol/src/approvals.rs#L34-L44)

```rust
/// Proposed execpolicy change to allow commands starting with this prefix.
///
/// The `command` tokens form the prefix that would be added as an execpolicy
/// `prefix_rule(..., decision="allow")`, letting the agent bypass approval for
/// commands that start with this token sequence.
pub struct ExecPolicyAmendment {
    pub command: Vec<String>,
}
```

[`item.rs#L66-L85`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L66-L85)

```rust
AcceptWithExecpolicyAmendment { execpolicy_amendment: ExecPolicyAmendment },
/// User chose a persistent network policy rule (allow/deny) for this host.
ApplyNetworkPolicyAmendment { network_policy_amendment: NetworkPolicyAmendment },
/// User denied the command. The agent will continue the turn.
Decline,
/// User denied the command. The turn will also be immediately interrupted.
Cancel,
```

### 10. headless/non-interactive 默认值

**主张：** 官方源码中的 `codex exec` 默认 approval policy 是 `Never`；官方仓库只把非交互模式的用户文档链接到产品文档，产品文档不是实现本身。

[`exec/src/lib.rs#L563-L570`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/exec/src/lib.rs#L563-L570)

```rust
let overrides = ConfigOverrides {
    model,
    review_model: None,
    // Default to never ask for approvals in headless mode. Rebuild below if
    // the fully resolved reviewer is AutoReview.
    approval_policy: Some(AskForApproval::Never),
    approvals_reviewer: None,
    sandbox_mode,
```

**边界：** `Never` 只表示不向用户发 approval prompt；它不会把危险命令变成安全命令，而是按 policy 变成 forbidden 或把 sandbox failure 直接返回给模型。

## 具体 trace

场景：trusted workspace，默认 `:workspace`，`approval_policy = on-request`；模型调用 `exec_command`，请求 `sandbox_permissions = require_escalated`，命令未命中 allow rule 且不含 deny-read。

1. **构造环境。** orchestrator 从 tool request 得到 environment、workspace roots 和 permission profile；对普通本地执行将 profile 与 workspace roots 合成 effective filesystem policy。[`orchestrator.rs#L144-L166`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/orchestrator.rs#L144-L166)

   ```rust
   let environment = tool.turn_environment(req);
   let workspace_roots = environment.workspace_roots();
   let permission_profile = environment.permission_profile();
   let permissions = environment.permission_profile_with_workspace_roots();
   let file_system_sandbox_policy = permissions.file_system_sandbox_policy();
   let requirement = tool.exec_approval_requirement(req).unwrap_or_else(|| {
       default_exec_approval_requirement(approval_policy, &file_system_sandbox_policy)
   });
   ```

2. **执行策略判定。** exec policy 解析 command segments；未命中规则的 dangerous/override 请求在 `OnRequest` 下返回 `Prompt`，然后变成 `NeedsApproval`。[`exec_policy.rs#L809-L838`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/exec_policy.rs#L809-L838)

   ```rust
   AskForApproval::OnRequest => match file_system_sandbox_policy.kind {
       FileSystemSandboxKind::Restricted => {
           if sandbox_permissions.requests_sandbox_override() {
               Decision::Prompt
           } else {
               Decision::Allow
           }
       }
       ...
   }
   ```

3. **发起审批。** orchestrator 为 command 构造 approval action，带上 environment/cwd/sandbox/additional permissions，并交给 session `request_approval`。[`orchestrator.rs#L200-L223`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/orchestrator.rs#L200-L223)

   ```rust
   ExecApprovalRequirement::NeedsApproval { reason, .. } => {
       let action = tool.approval_action(req, &tool_ctx.call_id)?;
       let approval_ctx = ApprovalContext {
           ...
           approval_reason: reason.clone(),
           retry_reason: None,
       };
       tool_ctx.session.request_approval(action, approval_ctx).await?;
   }
   ```

4. **reviewer 路由。** hooks 先决；没有 hook 决策时，strict auto-review/Guardian 或用户处理。用户选择 `Accept` 后只允许当前请求继续；选择 `AcceptForSession` 才写入内存 cache；选择 `AcceptWithExecpolicyAmendment` 才产生持久规则。[`approvals.rs#L500-L520`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/approvals.rs#L500-L520)

5. **sandbox 执行。** 如果 sandboxed attempt 因网络阻断或权限失败，orchestrator 只有在工具允许 escalation、policy 允许再次审批且没有 deny-read 冲突时才建立第二次 approval；deny-read 会阻止 unsandboxed retry。[`orchestrator.rs#L361-L445`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/orchestrator.rs#L361-L445)

## 跨进程边界与恢复

### 11. RPC 权限 DTO 是白名单投影

**主张：** `RequestPermissionProfile` 在 app-server 边界只公开 network/file_system；`deny_unknown_fields` 和显式 TryFrom 把外部 payload 转为 core 类型，拒绝把内部对象直接穿过 RPC。

[`permissions.rs#L215-L245`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server-protocol/src/protocol/v2/permissions.rs#L215-L245)

```rust
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct RequestPermissionProfile {
    pub network: Option<AdditionalNetworkPermissions>,
    pub file_system: Option<AdditionalFileSystemPermissions>,
}
...
impl TryFrom<RequestPermissionProfile> for CoreRequestPermissionProfile {
    fn try_from(value: RequestPermissionProfile) -> Result<Self, Self::Error> {
        Ok(Self {
            network: value.network.map(CoreNetworkPermissions::from),
            file_system: value.file_system
                .map(CoreFileSystemPermissions::try_from).transpose()?,
        })
    }
}
```

### 12. standalone process 是另一条 capability path

**主张：** `process/spawn` 只要求 local environment，检查 command 非空、handle 唯一、PTY 参数合法，然后交给 process manager；它不会走 Codex approval/sandbox orchestrator。

[`process_exec_processor.rs#L69-L145`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server/src/request_processors/process_exec_processor.rs#L69-L145)

```rust
pub(crate) async fn process_spawn(...) -> Result<(), JSONRPCErrorError> {
    self.require_local_environment()?;
    let ProcessSpawnParams { command, process_handle, cwd, ... } = params;
    if command.is_empty() {
        return Err(invalid_request("command must not be empty"));
    }
    if process_handle.is_empty() {
        return Err(invalid_request("processHandle must not be empty"));
    }
    ...
    self.process_exec_manager.start(StartProcessParams { ... }).await?;
    Ok(())
}
```

**不成立条件：** 不能把 app-server 的 `process/spawn` 当作“带 approval 的统一 exec”；若调用方需要 sandbox capability，必须走 agent tool/unified exec 或显式外部 sandbox。

### 13. resume/recovery 的权限语义

**主张：** thread resume 支持 thread_id/history/path 三种来源，并允许 override approval policy、sandbox、named permission profile、runtime workspace roots；响应会返回有效 approval policy、sandbox 和 active permission profile。

[`thread.rs#L340-L464`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L340-L464)

```rust
/// There are three ways to resume a thread:
/// 1. By thread_id: load the thread from disk by thread_id and resume it.
/// 2. By history: instantiate the thread from memory and resume it.
/// 3. By path: load the thread from disk by path and resume it.
...
pub approval_policy: Option<AskForApproval>,
pub sandbox: Option<SandboxMode>,
pub permissions: Option<String>,
pub runtime_workspace_roots: Option<Vec<AbsolutePathBuf>>,
...
pub approval_policy: AskForApproval,
pub sandbox: SandboxPolicy,
pub active_permission_profile: Option<ActivePermissionProfile>,
```

**测试事实：** persisted approval policy 会恢复，显式 override 会赢；cold resume 会重新解析 active profile，profile 删除时按当前 default 回落。[`thread_resume.rs#L1581-L1700`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server/tests/suite/v2/thread_resume.rs#L1581-L1700)

## 失败、取消与边界

### 14. 失败结果不是统一的 denied

**主张：** `Denied`/超时会成为 rejected tool result，`Abort` 会成为 `TurnAborted`；网络 policy deny 也有单独分支，Guardian abort 可能投影为“automatic approval review was cancelled”。

[`approvals.rs#L438-L469`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/approvals.rs#L438-L469)

```rust
match self.decision {
    ReviewDecision::NetworkPolicyAmendment { ... } if action == Deny => {
        Err(ToolError::Rejected(rejection.to_string()))
    }
    ReviewDecision::Denied { rejection } => Err(ToolError::Rejected(rejection)),
    ReviewDecision::TimedOut => Err(ToolError::Rejected(timeout_instructions.to_string())),
    ReviewDecision::Abort => Err(ToolError::Codex(CodexErr::TurnAborted)),
    decision => Ok(decision),
}
```

### 15. 取消会清理跨进程 pending request

**主张：** app-server 以 thread_id 维护 pending callbacks；turn 状态变化时会批量取消该 thread 的 server requests，并给等待者发送显式错误，避免审批请求悬挂。

[`outgoing_message.rs#L215-L229`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server/src/outgoing_message.rs#L215-L229)

```rust
pub(crate) async fn abort_pending_server_requests(&self) {
    self.outgoing
        .cancel_requests_for_thread(
            self.thread_id,
            Some({
                let mut error = internal_error(
                    "client request resolved because the turn state was changed",
                );
                error.data = Some(serde_json::json!({
                    "reason": TURN_TRANSITION_PENDING_REQUEST_ERROR_REASON,
                }));
                error
            }),
        )
        .await
}
```

### 16. process lifecycle 的连接边界

**主张：** process handle 是 connection-scoped；相同 handle 在同一连接上不能重复占用，连接关闭时 process manager 会处理对应 session，输出/退出通过独立 notification DTO 发送。

[`process.rs#L19-L50`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server-protocol/src/protocol/v2/process.rs#L19-L50)

```rust
/// `process/spawn` returns after the process has started and the connection-scoped
/// `processHandle` has been registered. Process output and exit are reported via
/// `process/outputDelta` and `process/exited` notifications.
pub struct ProcessSpawnParams {
    pub command: Vec<String>,
    /// Client-supplied, connection-scoped process handle.
    pub process_handle: String,
    pub cwd: AbsolutePathBuf,
```

## 测试覆盖

| 维度 | 现有一手测试 | 证据 |
|---|---|---|
| approval policy | `never/on-request`, approval mode 与 bypass 组合 | [`approval_policy.rs#L54-L74`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/exec/tests/suite/approval_policy.rs#L54-L74) |
| sandbox filesystem | workspace root 与 command cwd 区分、首次创建 `.codex` 被阻止 | [`sandbox.rs#L264-L346`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/exec/tests/suite/sandbox.rs#L264-L346) |
| approval cache | session cache 只命中 `ApprovedForSession` | [`sandboxing.rs#L83-L114`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/sandboxing.rs#L83-L114) |
| RPC process | spawn、output、cap、kill、local environment disabled | [`process_exec.rs#L23-L140`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server/tests/suite/v2/process_exec.rs#L23-L140) |
| resume | persisted policy/profile、override precedence、profile 删除回落 | [`thread_resume.rs#L1049-L1075`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server/tests/suite/v2/thread_resume.rs#L1049-L1075) |
| sandbox capability probe | Linux sandbox 不可施加时跳过依赖平台的行为测试 | [`sandbox.rs#L97-L129`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/exec/tests/suite/sandbox.rs#L97-L129) |

## 失败/边界清单

- **Windows sandbox disabled：** managed filesystem restrictions 不能靠“策略形状”提供真实隔离；源码对未启用 backend 保持 conservative decision，默认 profile 也会偏向 read-only。[`exec_policy.rs#L784-L805`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/exec_policy.rs#L784-L805)
- **deny-read + escalation：** 允许 escalation 不代表可以去掉 sandbox；否则会静默放开 deny-read。[`sandboxing.rs#L270-L296`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/sandboxing.rs#L270-L296)
- **`Never` + prompt：** approval policy disallows surfacing prompt 时是 forbidden，不是自动批准。[`exec_policy.rs#L210-L237`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/exec_policy.rs#L210-L237)
- **hook/Guardian 失败：** hook deny、Guardian deny、timeout、abort 会进入不同的 rejection/abort 路径，调用方不能只检查一个布尔值。[`approvals.rs#L438-L469`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/approvals.rs#L438-L469)
- **process/spawn：** 这是无 Codex sandbox 的 standalone host process；若 RPC 客户端把它暴露给低信任调用方，权限边界会被绕开。[`process.rs#L19-L24`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server-protocol/src/protocol/v2/process.rs#L19-L24)
- **resume after profile deletion：** 旧 thread 的 profile id 不保证永远可解析；源码测试要求回落到当前 configured default，因此 durable state 需要处理 profile 删除/重命名。[`thread_resume.rs#L1655-L1700`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server/tests/suite/v2/thread_resume.rs#L1655-L1700)
- **平台测试 skip：** sandbox 行为依赖宿主是否有可施加的 backend；跨平台结论不能只根据 Linux CI 的结果外推。[`sandbox.rs#L97-L129`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/exec/tests/suite/sandbox.rs#L97-L129)

## 不成立条件

1. 不能把 `approval_policy = never` 解释为“所有命令都能执行”；危险命令、policy prompt 和无有效 sandbox 的命令会被拒绝。
2. 不能把 `AcceptForSession` 解释为持久授权；它只落在 session 内存 cache，持久化需要 amendment。
3. 不能把 workspace trust 解释为“全盘 unrestricted”；trust 只决定项目配置/hooks/exec policy 是否能参与，最终能力仍由 profile、sandbox、network policy 和 approval policy 共同决定。
4. 不能把 app-server 的 `process/spawn` 解释为 Codex 的 sandboxed exec；协议注释明确它不带 Codex sandbox。
5. 不能把 resume 解释为恢复旧运行时的所有 ephemeral state；源码测试证明 policy/profile 会按 durable state 与当前 config 重新解析，而 session approval cache 的跨进程持久化没有证据支持。
6. 不能把通过 sandbox 测试解释为所有平台都执行了隔离验证；平台 capability 不满足时相关测试会 skip。

## 待验证项

- 当前 SHA 的 Guardian/auto-review 与 hooks 的完整配置来源、失败重试上限和超时具体数值尚未在本笔记展开；已确认 reviewer 优先级和结果投影，但还需要专门追 `guardian` 配置与 runtime timeout。
- network proxy 的 host matching、DNS/IPv6、Unix socket 和 credential broker 细节在本次权限主线中只确认了 profile 入口与 amendment 结果，尚未逐条复核所有 backend 实现。
- `process/spawn` 的 host 侧实际进程 hardening 取决于 local environment/executor 配置；本笔记只确认协议声明与 request processor 不经过 Codex sandbox，未把外部 executor 的 OS hardening 当成 Codex 权限语义。
- app-server 错误 DTO 的完整白名单投影需要继续核对所有 approval/rejection/error 类型；本次已核对 permission profile、approval item 和 pending request cancellation 的边界。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 只查 OpenAI 官方 `openai/codex`；源码固定在 `78245b47af2a7aafcabe025828ceecca69db4df1`，覆盖 `codex-rs/core`、`protocol`、`app-server`、`app-server-protocol`、`exec`、`tui`；仓库文档分别指向官方 security、exec-policy、noninteractive 页面。 |
| 作者或维护者本人的说法 | 未找到足以替代源码的作者博客/RFC；官方仓库文档把 sandbox/approval/exec policy 语义指向 `developers.openai.com/codex/security` 与 `developers.openai.com/codex/exec-policy`。 |
| 同类方案 | 按用户要求未查 pi agent、opencode、grok cli；本笔记是 Codex 单实现调研，不作跨项目结论。 |
| issue / PR / 社区实践 | 未查；本次问题重点是固定版本源码机制，源码与官方文档已覆盖权限主体、审批、sandbox、RPC 和测试；没有把社区反馈当作当前行为证据。 |
| 历史演变 | 仅查了当前 SHA 内的兼容字段和 resume tests，未展开 commit history；待验证项保留了 profile 删除回落、legacy path conversion 等历史兼容边界。 |

## 对本项目的影响

如果把 Codex 的经验映射到本项目，最值得保留的是“能力 profile、审批决策、执行策略、运行时 sandbox、跨进程 DTO、durable resume”六个边界，而不是把它们压成一个 `Permission` boolean。尤其要明确：session grant 与 durable policy 分开；deny-read 会限制 escalation；headless 的默认策略必须显式；RPC 入口要对白名单 DTO 做投影；standalone process 入口必须单独标注是否经过 sandbox。具体落地前仍需补齐上面的 Guardian/network backend/DTO 全量核验。
