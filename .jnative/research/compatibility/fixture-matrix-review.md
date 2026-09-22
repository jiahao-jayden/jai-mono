# Model Compatibility Fixture Matrix / AC Review

更新时间：2026-09-22

这份矩阵只记录当前仓库中可复现、已运行的证据；“未实现”不写成已完成。

## Fixture matrix

| 区域 | Fixture / 测试 | 当前断言 | 状态 |
|---|---|---|---|
| Resolver | `packages/ai/test/compatibility.test.ts` exact identity | identity > family > provider/dialect；记录 winning source | 通过 |
| Resolver | 同文件 unknown model | 不做 fuzzy matching，返回基础 profile | 通过 |
| Resolver | 同文件 duplicate/conflict | ambiguous/conflict 返回 TaggedError | 通过 |
| Catalog | `app/server/test/model-catalog/sqlite.test.ts` exact/revision/ambiguous | 只有 exact 套 metadata；revision/unknown 不套 quirks | 通过 |
| Catalog family inheritance | 同文件 `volcengine/deepseek-v4-1` fixture | catalog 明确确认 `family: deepseek-v4` 时继承 DeepSeek family policy，再叠加 endpoint/identity 层；未确认 family 不猜 | 通过 |
| Chat request | `packages/ai/test/openai.test.ts` | max token 字段、stream usage、profile reasoning format、providerOptions protected fields | 通过 |
| Responses request | 同文件 Responses fixtures | encrypted reasoning replay、strict tools、reasoning profile | 通过 |
| Anthropic request | `packages/ai/test/anthropic.test.ts` | thinking signature、tool result、cache breakpoint | 通过 |
| Tool protocol | `packages/ai/test/openai.test.ts` | malformed args、XML/DSML pseudo-tool、unknown tool fail-closed；native call 优先 | 通过 |
| Stream healing | `packages/ai/test/openai.test.ts` healing fixture | 显式开启的 thinking fence、special token、重复 reasoning delta 各最多一次 | 通过 |
| Operation admission | `app/server/test/runtime/host.test.ts` | admission 冻结旧 runtime configuration；后续配置只影响后续 work | 通过 |
| Session state | 全仓 `ProviderSessionState` / Responses chain 搜索 | 当前没有独立 provider session owner 或 durable chain store | 结论：不新增 |

## AC1–AC8 review

- **AC1 Resolver identity**：已覆盖 exact / unknown / revision / ambiguous；unknown 不猜 family quirks。
- **AC2 Provider request/stream**：Chat、Responses、Anthropic 现有 request/stream fixtures 通过；Anthropic 只迁移已有行为。
- **AC3 Request policy combinations**：`resolveRequestPolicy` 已统一 token、usage、strict tools、reasoning；组合测试通过。
- **AC4 Operation snapshot**：Host admission configuration freeze 已有公开行为测试；driver preflight cache 按 operation id 消费和清理。
- **AC5 Session scope**：代码核验确认当前没有 ProviderSessionState owner；不新增 durable store，Responses encrypted item 仅请求内 replay。
- **AC6 Bounded healing**：仅允许 profile 显式 capability 的三类 healing；每类单 stream 至多一次，之后仍做 protocol validation。
- **AC7 Error DTO**：resolver、provider option conflict、malformed tool args、model protocol violation 均使用 TaggedError / 安全错误投影。
- **AC8 Verification**：最近一次全量回归：AI 64、coding-agent 158、server 177，全部通过；三包 typecheck 与 `git diff --check` 通过。

## 明确限制

1. 没有真实 provider session state 的代码或 fixture，因此不宣称已完成“账号切换复用/清理”实现；该项结论是“不存在 owner，不迁移”。
2. healing 不解析 XML/DSML 文本工具调用，也不修复 malformed JSON；这些继续 fail-closed。
3. 当前工作区未提交、未推送；最终提交仍需等用户 review 后单一汇总提交。
