export type TelemetryContentReference =
	| { readonly kind: "omitted" }
	| { readonly kind: "hash"; readonly algorithm: "sha256"; readonly value: string }
	| { readonly kind: "redacted_excerpt"; readonly text: string }
	| { readonly kind: "approved_pointer"; readonly pointer: string };

/** 所有未明确批准的内容都以省略表达，不能用裸字符串替代。 */
export const omittedTelemetryContent: TelemetryContentReference = { kind: "omitted" };

export type TelemetryAttributeValue = string | number | boolean | TelemetryContentReference;

/** 错误只按少量稳定类别归档，绝不能把原始 message 当作类别。 */
export type TelemetryErrorCategory =
	| "aborted"
	| "cancelled"
	| "internal"
	| "permission"
	| "protocol"
	| "provider"
	| "telemetry"
	| "tool"
	| "unknown";

export type TelemetryPermissionDecision = "allow" | "ask" | "deny";
export type TelemetryPermissionRisk = "low" | "medium" | "high";
export type TelemetryPermissionSource = "rule" | "mode" | "built-in" | "danger-layer" | "extension";
export type TelemetryPermissionPhase = "initial" | "canonical" | "recheck" | "canonical_recheck";
export type TelemetryPermissionOutcome = "allowed" | "denied" | "recheck_denied" | "cancelled" | "failed";
export type TelemetryApprovalDecision = "deny" | "allowOnce" | "alwaysAllow";
export type TelemetryApprovalOutcome = "approved" | "denied" | "cancelled" | "failed";

export interface TelemetrySpanDefinitions {
	readonly "jai.run": {
		readonly parent: never;
		readonly attributes: {
			readonly operationId: string;
			readonly runId: string;
			readonly sessionId?: string;
		};
	};
	readonly "jai.turn": {
		readonly parent: "jai.run";
		readonly attributes: { readonly turnId: string };
	};
	readonly "jai.model_attempt": {
		readonly parent: "jai.turn";
		readonly attributes: {
			readonly attemptId: string;
			readonly cacheReadCost?: number;
			readonly cacheReadTokens?: number;
			readonly cacheWriteCost?: number;
			readonly cacheWriteTokens?: number;
			readonly inputCost?: number;
			readonly inputTokens?: number;
			readonly model: string;
			readonly outputCost?: number;
			readonly outputTokens?: number;
			readonly provider: string;
			readonly reasoningTokens?: number;
			readonly totalCost?: number;
			readonly totalTokens?: number;
		};
	};
	readonly "jai.model_stream": {
		readonly parent: "jai.model_attempt";
		readonly attributes: {
			readonly durationMs?: number;
			readonly firstOutputMs?: number;
			readonly outcome?: "completed" | "discarded" | "failed" | "aborted";
			readonly streamId: string;
		};
	};
	readonly "jai.tool_call": {
		readonly parent: "jai.turn";
		readonly attributes: {
			readonly durationMs?: number;
			readonly input?: TelemetryContentReference;
			readonly output?: TelemetryContentReference;
			readonly toolCallId: string;
			readonly toolName: string;
		};
	};
	readonly "jai.permission": {
		readonly parent: "jai.turn";
		readonly attributes: {
			readonly decision?: TelemetryPermissionDecision;
			readonly input?: TelemetryContentReference;
			readonly outcome?: TelemetryPermissionOutcome;
			readonly risk?: TelemetryPermissionRisk;
			readonly source?: TelemetryPermissionSource;
			readonly toolCallId: string;
			readonly toolName: string;
		};
	};
	readonly "jai.approval": {
		readonly parent: "jai.permission";
		readonly attributes: {
			readonly approvalId: string;
			readonly decision?: TelemetryApprovalDecision;
			readonly outcome?: TelemetryApprovalOutcome;
			readonly toolCallId: string;
			readonly toolName: string;
			readonly waitMs?: number;
		};
	};
}

export type TelemetrySpanName = keyof TelemetrySpanDefinitions;
export type TelemetrySpanAttributes<Name extends TelemetrySpanName> = TelemetrySpanDefinitions[Name]["attributes"];
export type TelemetrySpanParentName<Name extends TelemetrySpanName> = TelemetrySpanDefinitions[Name]["parent"];

export interface TelemetryEventDefinitions {
	readonly "jai.run.started": { readonly span: "jai.run"; readonly attributes: Record<never, never> };
	readonly "jai.run.finished": { readonly span: "jai.run"; readonly attributes: Record<never, never> };
	readonly "jai.turn.started": { readonly span: "jai.turn"; readonly attributes: Record<never, never> };
	readonly "jai.turn.finished": { readonly span: "jai.turn"; readonly attributes: Record<never, never> };
	readonly "jai.model_attempt.started": {
		readonly span: "jai.model_attempt";
		readonly attributes: Record<never, never>;
	};
	readonly "jai.model_attempt.settled": {
		readonly span: "jai.model_attempt";
		readonly attributes: { readonly outcome: "completed" | "discarded" | "failed" | "aborted" };
	};
	readonly "jai.model_stream.first_output": {
		readonly span: "jai.model_stream";
		readonly attributes: { readonly firstOutputMs: number };
	};
	readonly "jai.model_stream.settled": {
		readonly span: "jai.model_stream";
		readonly attributes: { readonly durationMs: number };
	};
	readonly "jai.tool_call.dispatched": { readonly span: "jai.tool_call"; readonly attributes: Record<never, never> };
	readonly "jai.tool_call.settled": {
		readonly span: "jai.tool_call";
		readonly attributes: { readonly durationMs: number };
	};
	readonly "jai.permission.decided": {
		readonly span: "jai.permission";
		readonly attributes: {
			readonly decision: TelemetryPermissionDecision;
			readonly phase: TelemetryPermissionPhase;
			readonly risk: TelemetryPermissionRisk;
			readonly source: TelemetryPermissionSource;
		};
	};
	readonly "jai.permission.settled": {
		readonly span: "jai.permission";
		readonly attributes: { readonly outcome: TelemetryPermissionOutcome };
	};
	readonly "jai.approval.requested": { readonly span: "jai.approval"; readonly attributes: Record<never, never> };
	readonly "jai.approval.decided": {
		readonly span: "jai.approval";
		readonly attributes: { readonly decision: TelemetryApprovalDecision };
	};
	readonly "jai.approval.settled": {
		readonly span: "jai.approval";
		readonly attributes: { readonly outcome: TelemetryApprovalOutcome; readonly waitMs: number };
	};
}

export type TelemetryEventName = keyof TelemetryEventDefinitions;
export type TelemetryEventAttributes<Name extends TelemetryEventName> = TelemetryEventDefinitions[Name]["attributes"];
export type TelemetryEventNameForSpan<Name extends TelemetrySpanName> = {
	[EventName in TelemetryEventName]: TelemetryEventDefinitions[EventName]["span"] extends Name ? EventName : never;
}[TelemetryEventName];

export type TelemetryEventInput<Name extends TelemetryEventName> = {
	readonly attributes?: Partial<TelemetryEventAttributes<Name>>;
	readonly name: Name;
};

export type TelemetrySpanStatus =
	| { readonly kind: "ok" }
	| { readonly kind: "error"; readonly message?: TelemetryContentReference; readonly name?: TelemetryErrorCategory };

export interface TelemetryEventRecord {
	readonly attributes: Readonly<Record<string, TelemetryAttributeValue>>;
	readonly name: TelemetryEventName;
	readonly timestampMs: number;
}

export interface TelemetrySpanRecord {
	readonly attributes: Readonly<Record<string, TelemetryAttributeValue>>;
	readonly endedAtMs?: number;
	readonly events: readonly TelemetryEventRecord[];
	readonly id: string;
	readonly name: TelemetrySpanName;
	readonly parentId?: string;
	/** 仅用于跨 sink 关联同一次内存运行；不包含用户内容。 */
	readonly runId?: string;
	readonly schemaVersion: 1;
	/** Langfuse 等 observation 后端需要每个 span 都携带此安全的会话标识。 */
	readonly sessionId?: string;
	readonly startedAtMs: number;
	readonly status?: TelemetrySpanStatus;
	/** 由 context 在创建 span 时固定，避免 sink 依赖交付顺序重建 trace。 */
	readonly traceId: string;
	readonly traceName: string;
}

export interface TelemetrySink {
	record(record: TelemetrySpanRecord): void | Promise<void>;
}

export interface TelemetrySpan<Name extends TelemetrySpanName = TelemetrySpanName> {
	readonly id: string;
	readonly name: Name;
	addEvent<EventName extends TelemetryEventNameForSpan<Name>>(event: TelemetryEventInput<EventName>): void;
	setAttributes(attributes: Partial<TelemetrySpanAttributes<Name>>): void;
	setStatus(status: TelemetrySpanStatus): void;
}

type TelemetrySpanParentOption<Name extends TelemetrySpanName> = [TelemetrySpanParentName<Name>] extends [never]
	? { readonly parent?: undefined }
	: { readonly parent: TelemetrySpan<TelemetrySpanParentName<Name>> };

export type TelemetryStartSpanOptions<Name extends TelemetrySpanName> = {
	readonly attributes?: Partial<TelemetrySpanAttributes<Name>>;
	readonly name: Name;
} & TelemetrySpanParentOption<Name>;

/** 领域代码只依赖这一端口；sink、时钟和输出目的地均由宿主装配。 */
export interface TelemetryContext {
	startSpan<Name extends TelemetrySpanName>(options: TelemetryStartSpanOptions<Name>): TelemetrySpan<Name>;
}

export interface TelemetryContextOptions {
	/** 测试可注入 trace identity；生产缺省使用安全随机值。 */
	readonly createTraceId?: () => string;
	readonly now?: () => number;
	/** 仅供 in-memory 测试替身保留 span 生命周期；回调永远只收到安全投影。 */
	readonly onSpanStateChange?: (record: TelemetrySpanRecord) => void;
	readonly sinks?: readonly TelemetrySink[];
}
