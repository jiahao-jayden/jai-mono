/**
 * Permission 子系统对外出口（auto-mode + danger-only ask）。
 */

export {
	type DangerCheck,
	type DangerCheckCtx,
	DEFAULT_DANGER_CHECKS,
	detectDanger,
	isInside,
	toAbs,
} from "./danger-checks.js";
export { PermissionPolicy, type PermissionPolicyDeps } from "./policy.js";
export { type PermissionSettings, PermissionSettingsSchema } from "./schema.js";
export { type PendingListener, type PendingPermission, PermissionService } from "./service.js";
export * from "./types.js";
