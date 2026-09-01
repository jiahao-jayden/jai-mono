import {
	omittedTelemetryContent,
	type TelemetryAttributeValue,
	type TelemetryContentReference,
	type TelemetryEventAttributes,
	type TelemetryEventName,
	type TelemetrySpanAttributes,
	type TelemetrySpanName,
} from "./contracts";

type AttributeKind = "boolean" | "content" | "number" | "string";

interface AttributeSchema {
	readonly key: string;
	readonly kind: AttributeKind;
}

const spanAttributeSchemas: Record<TelemetrySpanName, readonly AttributeSchema[]> = {
	"jai.run": [
		{ key: "operationId", kind: "string" },
		{ key: "runId", kind: "string" },
		{ key: "sessionId", kind: "string" },
	],
	"jai.turn": [{ key: "turnId", kind: "string" }],
	"jai.model_attempt": [
		{ key: "attemptId", kind: "string" },
		{ key: "cacheReadCost", kind: "number" },
		{ key: "cacheReadTokens", kind: "number" },
		{ key: "cacheWriteCost", kind: "number" },
		{ key: "cacheWriteTokens", kind: "number" },
		{ key: "inputCost", kind: "number" },
		{ key: "inputTokens", kind: "number" },
		{ key: "model", kind: "string" },
		{ key: "outputCost", kind: "number" },
		{ key: "outputTokens", kind: "number" },
		{ key: "provider", kind: "string" },
		{ key: "reasoningTokens", kind: "number" },
		{ key: "totalCost", kind: "number" },
		{ key: "totalTokens", kind: "number" },
	],
	"jai.model_stream": [
		{ key: "durationMs", kind: "number" },
		{ key: "firstOutputMs", kind: "number" },
		{ key: "outcome", kind: "string" },
		{ key: "streamId", kind: "string" },
	],
	"jai.tool_call": [
		{ key: "durationMs", kind: "number" },
		{ key: "input", kind: "content" },
		{ key: "output", kind: "content" },
		{ key: "toolCallId", kind: "string" },
		{ key: "toolName", kind: "string" },
	],
	"jai.permission": [
		{ key: "decision", kind: "string" },
		{ key: "input", kind: "content" },
		{ key: "outcome", kind: "string" },
		{ key: "risk", kind: "string" },
		{ key: "source", kind: "string" },
		{ key: "toolCallId", kind: "string" },
		{ key: "toolName", kind: "string" },
	],
	"jai.approval": [
		{ key: "approvalId", kind: "string" },
		{ key: "decision", kind: "string" },
		{ key: "outcome", kind: "string" },
		{ key: "toolCallId", kind: "string" },
		{ key: "toolName", kind: "string" },
		{ key: "waitMs", kind: "number" },
	],
};

const eventAttributeSchemas: Record<TelemetryEventName, readonly AttributeSchema[]> = {
	"jai.run.started": [],
	"jai.run.finished": [],
	"jai.turn.started": [],
	"jai.turn.finished": [],
	"jai.model_attempt.started": [],
	"jai.model_attempt.settled": [{ key: "outcome", kind: "string" }],
	"jai.model_stream.first_output": [{ key: "firstOutputMs", kind: "number" }],
	"jai.model_stream.settled": [{ key: "durationMs", kind: "number" }],
	"jai.tool_call.dispatched": [],
	"jai.tool_call.settled": [{ key: "durationMs", kind: "number" }],
	"jai.permission.decided": [
		{ key: "decision", kind: "string" },
		{ key: "phase", kind: "string" },
		{ key: "risk", kind: "string" },
		{ key: "source", kind: "string" },
	],
	"jai.permission.settled": [{ key: "outcome", kind: "string" }],
	"jai.approval.requested": [],
	"jai.approval.decided": [{ key: "decision", kind: "string" }],
	"jai.approval.settled": [
		{ key: "outcome", kind: "string" },
		{ key: "waitMs", kind: "number" },
	],
};

export const eventSpanNames: Readonly<Record<TelemetryEventName, TelemetrySpanName>> = {
	"jai.run.started": "jai.run",
	"jai.run.finished": "jai.run",
	"jai.turn.started": "jai.turn",
	"jai.turn.finished": "jai.turn",
	"jai.model_attempt.started": "jai.model_attempt",
	"jai.model_attempt.settled": "jai.model_attempt",
	"jai.model_stream.first_output": "jai.model_stream",
	"jai.model_stream.settled": "jai.model_stream",
	"jai.tool_call.dispatched": "jai.tool_call",
	"jai.tool_call.settled": "jai.tool_call",
	"jai.permission.decided": "jai.permission",
	"jai.permission.settled": "jai.permission",
	"jai.approval.requested": "jai.approval",
	"jai.approval.decided": "jai.approval",
	"jai.approval.settled": "jai.approval",
};

export function projectSpanAttributes<Name extends TelemetrySpanName>(
	name: Name,
	attributes: Partial<TelemetrySpanAttributes<Name>>,
	includeContentDefaults: boolean,
): Readonly<Record<string, TelemetryAttributeValue>> {
	return projectKnownAttributes(spanAttributeSchemas[name], attributes, includeContentDefaults);
}

export function projectEventAttributes<Name extends TelemetryEventName>(
	name: Name,
	attributes: Partial<TelemetryEventAttributes<Name>> | undefined,
): Readonly<Record<string, TelemetryAttributeValue>> {
	return projectKnownAttributes(eventAttributeSchemas[name], attributes ?? {}, false);
}

export function projectContentReference(value: unknown): TelemetryContentReference {
	if (!isRecord(value) || typeof value.kind !== "string") return omittedTelemetryContent;
	if (value.kind === "omitted") return omittedTelemetryContent;
	if (value.kind === "hash" && value.algorithm === "sha256" && typeof value.value === "string") {
		return { kind: "hash", algorithm: "sha256", value: value.value };
	}
	if (value.kind === "redacted_excerpt" && typeof value.text === "string") {
		return { kind: "redacted_excerpt", text: value.text };
	}
	if (value.kind === "approved_pointer" && typeof value.pointer === "string") {
		return { kind: "approved_pointer", pointer: value.pointer };
	}
	return omittedTelemetryContent;
}

function projectKnownAttributes(
	schema: readonly AttributeSchema[],
	attributes: object,
	includeContentDefaults: boolean,
): Readonly<Record<string, TelemetryAttributeValue>> {
	const projected: Record<string, TelemetryAttributeValue> = {};
	for (const entry of schema) {
		const value = Reflect.get(attributes, entry.key);
		const safeValue = projectAttribute(entry, value, includeContentDefaults);
		if (safeValue !== undefined) projected[entry.key] = safeValue;
	}
	return projected;
}

function projectAttribute(
	schema: AttributeSchema,
	value: unknown,
	includeContentDefaults: boolean,
): TelemetryAttributeValue | undefined {
	if (schema.kind === "content") {
		if (value === undefined && !includeContentDefaults) return undefined;
		return projectContentReference(value);
	}
	if (schema.kind === "string" && typeof value === "string") return value;
	if (schema.kind === "number" && typeof value === "number" && Number.isFinite(value)) return value;
	if (schema.kind === "boolean" && typeof value === "boolean") return value;
	return undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	return true;
}
