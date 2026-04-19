/**
 * Permission system core types — auto-mode + danger-only ask.
 *
 * 设计：默认全部放行（auto），只有命中"内置危险检测"才会异步问用户。
 * 用户回复仅有两种语义："允许这一次" / "拒绝"；
 * 同会话内同 (toolName + key) 在选择允许后会被静音（in-memory），重启即重置。
 */

/** 危险检测的产物：传给 PermissionService → 转发给 UI 弹窗。 */
export type PermissionRequest = {
	/** 危险类别（"external_write" / "sensitive_path" / "external_read" / "dangerous_bash" 等），用于 UI 文案和 mute key。 */
	category: string;
	/** 人类可读的 reason，UI 直接展示。 */
	reason: string;
	/** 用于"本会话不再问"的去重键；同 (toolName, muteKey) 静音一次后续直接放行。 */
	muteKey: string;
	/** UI 展示的附加信息（路径、命令、目录等）。 */
	metadata?: Record<string, unknown>;
};

/** 用户回复审批时的决策。 */
export type PermissionDecision =
	| { kind: "allow_once" }
	| { kind: "allow_session" }
	| { kind: "reject"; reason?: string };
