import type {
	TelemetryApprovalDecision,
	TelemetryPermissionDecision,
	TelemetryPermissionOutcome,
	TelemetryPermissionPhase,
	TelemetryPermissionRisk,
	TelemetryPermissionSource,
} from "@jai/telemetry";

/** 权限中间件只发布已白名单的决策事实，绝不携带路径、命令、参数或 reason。 */
export type PermissionTelemetryEvent =
	| {
			readonly type: "permission_decided";
			readonly decision: TelemetryPermissionDecision;
			readonly phase: TelemetryPermissionPhase;
			readonly risk: TelemetryPermissionRisk;
			readonly source: TelemetryPermissionSource;
			readonly toolCallId: string;
			readonly toolName: string;
	  }
	| {
			readonly type: "approval_requested";
			readonly approvalId: string;
			readonly toolCallId: string;
			readonly toolName: string;
	  }
	| {
			readonly type: "approval_decided";
			readonly approvalId: string;
			readonly decision: TelemetryApprovalDecision;
	  }
	| {
			readonly type: "approval_cancelled" | "approval_failed";
			readonly approvalId: string;
	  }
	| {
			readonly type: "permission_settled";
			readonly outcome: TelemetryPermissionOutcome;
			readonly toolCallId: string;
	  };

/** 可选旁路；实现抛错不得影响任何权限判定或审批流程。 */
export interface PermissionTelemetryObserver {
	observePermissionEvent(event: PermissionTelemetryEvent): void;
}
