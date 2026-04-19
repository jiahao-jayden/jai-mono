/**
 * PermissionPolicy —— "auto + danger-only ask" 的极简策略。
 *
 * 流程：
 *   beforeToolCall(ctx)
 *     ① detectDanger(toolName, args, dangerCtx)
 *        - null → 放行（return undefined）
 *     ② 检查会话内 mute：命中 → 直接放行
 *     ③ service.request(req) → 等用户回复
 *        - reject → 返回 error 阻止执行
 *        - allow_once → 放行，不静音
 *        - allow_session → 放行，并把 muteKey 写入会话 mute set
 */

import { type BeforeToolCallContext, type BeforeToolCallResult, createErrorResult } from "@jayden/jai-agent";
import { type DangerCheck, DEFAULT_DANGER_CHECKS, detectDanger } from "./danger-checks.js";
import type { PermissionSettings } from "./schema.js";
import type { PermissionService } from "./service.js";

export type PermissionPolicyDeps = {
	cwd: string;
	settings: PermissionSettings;
	service: PermissionService;
	/** 默认 DEFAULT_DANGER_CHECKS；测试时可注入 */
	checks?: DangerCheck[];
};

export class PermissionPolicy {
	private mutedKeys = new Set<string>();

	constructor(private deps: PermissionPolicyDeps) {}

	/** 单一入口：装到 AgentSession.beforeToolCall 链尾。 */
	dangerHandler = async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
		const danger = detectDanger(
			ctx.toolName,
			ctx.args,
			{
				cwd: this.deps.cwd,
				extraDangerousPaths: this.deps.settings.dangerousPaths,
			},
			this.deps.checks ?? DEFAULT_DANGER_CHECKS,
		);

		if (!danger) return undefined;

		// 会话内已确认过同 muteKey → 直接放行
		if (this.mutedKeys.has(`${ctx.toolName}:${danger.muteKey}`)) {
			return undefined;
		}

		const { promise } = this.deps.service.request({
			toolCallId: ctx.toolCallId,
			toolName: ctx.toolName,
			request: danger,
		});

		const decision = await promise;

		if (decision.kind === "reject") {
			return {
				skip: true,
				result: createErrorResult(decision.reason ?? `User rejected ${danger.category}`),
			};
		}

		if (decision.kind === "allow_session") {
			this.mutedKeys.add(`${ctx.toolName}:${danger.muteKey}`);
		}

		return undefined; // allow_once / allow_session 都放行
	};

	/** 仅测试 / 调试。 */
	clearMutes(): void {
		this.mutedKeys.clear();
	}
}
