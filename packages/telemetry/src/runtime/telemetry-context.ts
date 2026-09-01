import {
	omittedTelemetryContent,
	type TelemetryAttributeValue,
	type TelemetryContentReference,
	type TelemetryContext,
	type TelemetryContextOptions,
	type TelemetryErrorCategory,
	type TelemetryEventInput,
	type TelemetryEventName,
	type TelemetryEventNameForSpan,
	type TelemetryEventRecord,
	type TelemetrySink,
	type TelemetrySpan,
	type TelemetrySpanAttributes,
	type TelemetrySpanName,
	type TelemetrySpanRecord,
	type TelemetrySpanStatus,
	type TelemetryStartSpanOptions,
} from "../core/contracts";
import {
	eventSpanNames,
	projectContentReference,
	projectEventAttributes,
	projectSpanAttributes,
} from "../core/vocabulary";

interface RuntimeSpanState {
	readonly attributes: Record<string, TelemetryAttributeValue>;
	readonly events: TelemetryEventRecord[];
	readonly id: string;
	readonly name: TelemetrySpanName;
	readonly parentId?: string;
	readonly runId?: string;
	readonly sessionId?: string;
	readonly startedAtMs: number;
	readonly traceId: string;
	readonly traceName: string;
	endedAtMs?: number;
	status?: TelemetrySpanStatus;
}

/** 宿主在组合根创建；未提供 sink 时仍是完整但无输出的安全旁路。 */
export function createTelemetryContext(options: TelemetryContextOptions = {}): TelemetryContext {
	const sinks = options.sinks ?? [];
	return new RuntimeTelemetryContext(sinks, options.createTraceId, options.now, options.onSpanStateChange);
}

export async function runWithTelemetrySpan<Name extends TelemetrySpanName, Value>(
	context: TelemetryContext,
	options: TelemetryStartSpanOptions<Name>,
	callback: (span: TelemetrySpan<Name>) => Value | Promise<Value>,
): Promise<Value> {
	const span = context.startSpan(options);
	try {
		const value = await callback(span);
		span.setStatus({ kind: "ok" });
		return value;
	} catch (error) {
		span.setStatus({ kind: "error", name: errorCategory(error), message: omittedTelemetryContent });
		throw error;
	}
}

class RuntimeTelemetryContext implements TelemetryContext {
	readonly #now: () => number;
	readonly #onSpanStateChange: ((record: TelemetrySpanRecord) => void) | undefined;
	readonly #sinks: readonly TelemetrySink[];
	readonly #states = new WeakMap<object, RuntimeSpanState>();
	readonly #createTraceId: (() => string) | undefined;
	#nextSpanId = 1;

	constructor(
		sinks: readonly TelemetrySink[],
		createTraceId: (() => string) | undefined,
		now: (() => number) | undefined,
		onSpanStateChange: ((record: TelemetrySpanRecord) => void) | undefined,
	) {
		this.#sinks = [...sinks];
		this.#now = now ?? Date.now;
		this.#onSpanStateChange = onSpanStateChange;
		this.#createTraceId = createTraceId;
	}

	startSpan<Name extends TelemetrySpanName>(options: TelemetryStartSpanOptions<Name>): TelemetrySpan<Name> {
		const parent = this.#resolveParent(options.parent);
		const attributes = this.#initialAttributes(options.name, options.attributes);
		const sessionId = parent?.sessionId ?? readSessionId(options.name, attributes);
		const runId = parent?.runId ?? readRunId(options.name, attributes);
		const state: RuntimeSpanState = {
			attributes,
			events: [],
			id: `span-${this.#nextSpanId++}`,
			name: options.name,
			...(parent === undefined ? {} : { parentId: parent.id }),
			...(runId === undefined ? {} : { runId }),
			...(sessionId === undefined ? {} : { sessionId }),
			startedAtMs: this.#readNow(),
			traceId: parent?.traceId ?? this.#readTraceId(),
			traceName: parent?.traceName ?? options.name,
		};
		const span = new RuntimeTelemetrySpan(this, state.id, options.name);
		this.#states.set(span, state);
		this.#notifySpanState(state);
		return span;
	}

	setAttributes<Name extends TelemetrySpanName>(
		span: object,
		attributes: Partial<TelemetrySpanAttributes<Name>>,
	): void {
		const state = this.#states.get(span);
		if (!state || state.status) return;
		try {
			Object.assign(state.attributes, projectSpanAttributes(state.name, attributes, false));
			this.#notifySpanState(state);
		} catch {
			return;
		}
	}

	addEvent<Name extends TelemetrySpanName>(
		span: object,
		event: TelemetryEventInput<TelemetryEventNameForSpan<Name>>,
	): void {
		const state = this.#states.get(span);
		if (!state || state.status) return;
		try {
			const eventName = event.name as TelemetryEventName;
			if (eventSpanNames[eventName] !== state.name) return;
			state.events.push({
				attributes: projectEventAttributes(eventName, event.attributes),
				name: eventName,
				timestampMs: this.#readNow(),
			});
			this.#notifySpanState(state);
		} catch {
			return;
		}
	}

	setStatus(span: object, status: TelemetrySpanStatus): void {
		const state = this.#states.get(span);
		if (!state || state.status) return;
		state.status = this.#projectStatus(status);
		state.endedAtMs = this.#readNow();
		const record = createSpanRecord(state);
		this.#notifySpanState(state);
		this.#emit(record);
	}

	#initialAttributes<Name extends TelemetrySpanName>(
		name: Name,
		attributes: Partial<TelemetrySpanAttributes<Name>> | undefined,
	): Record<string, TelemetryAttributeValue> {
		try {
			return { ...projectSpanAttributes(name, attributes ?? {}, true) };
		} catch {
			return { ...projectSpanAttributes(name, {}, true) };
		}
	}

	#resolveParent(parent: TelemetrySpan | undefined): RuntimeSpanState | undefined {
		if (parent === undefined) return undefined;
		const parentState = this.#states.get(parent);
		if (parentState) return parentState;
		throw new Error("Telemetry span parent must belong to the same telemetry context");
	}

	#projectStatus(status: TelemetrySpanStatus): TelemetrySpanStatus {
		try {
			if (status.kind === "ok") return { kind: "ok" };
			return {
				kind: "error",
				...(isTelemetryErrorCategory(status.name) ? { name: status.name } : {}),
				message: projectContentReference(status.message),
			};
		} catch {
			return { kind: "error", name: "telemetry", message: omittedTelemetryContent };
		}
	}

	#readNow(): number {
		try {
			const timestamp = this.#now();
			return Number.isFinite(timestamp) ? timestamp : Date.now();
		} catch {
			return Date.now();
		}
	}

	#readTraceId(): string {
		return resolveTraceId(this.#createTraceId);
	}

	#emit(record: TelemetrySpanRecord): void {
		for (const sink of this.#sinks) {
			const copy = cloneSpanRecord(record);
			void Promise.resolve()
				.then(() => {
					return sink.record(copy);
				})
				.catch(() => {
					return undefined;
				});
		}
	}

	#notifySpanState(state: RuntimeSpanState): void {
		try {
			this.#onSpanStateChange?.(createSpanRecord(state));
		} catch {
			return;
		}
	}
}

class RuntimeTelemetrySpan<Name extends TelemetrySpanName> implements TelemetrySpan<Name> {
	readonly id: string;
	readonly name: Name;
	readonly #context: RuntimeTelemetryContext;

	constructor(context: RuntimeTelemetryContext, id: string, name: Name) {
		this.#context = context;
		this.id = id;
		this.name = name;
	}

	addEvent<EventName extends TelemetryEventNameForSpan<Name>>(event: TelemetryEventInput<EventName>): void {
		this.#context.addEvent<Name>(this, event);
		return;
	}

	setAttributes(attributes: Parameters<TelemetrySpan<Name>["setAttributes"]>[0]): void {
		this.#context.setAttributes<Name>(this, attributes);
		return;
	}

	setStatus(status: TelemetrySpanStatus): void {
		this.#context.setStatus(this, status);
		return;
	}
}

function createSpanRecord(state: RuntimeSpanState): TelemetrySpanRecord {
	return {
		attributes: cloneAttributes(state.attributes),
		...(state.endedAtMs === undefined ? {} : { endedAtMs: state.endedAtMs }),
		events: state.events.map(cloneEventRecord),
		id: state.id,
		name: state.name,
		...(state.parentId === undefined ? {} : { parentId: state.parentId }),
		...(state.runId === undefined ? {} : { runId: state.runId }),
		schemaVersion: 1,
		...(state.sessionId === undefined ? {} : { sessionId: state.sessionId }),
		startedAtMs: state.startedAtMs,
		...(state.status === undefined ? {} : { status: cloneStatus(state.status) }),
		traceId: state.traceId,
		traceName: state.traceName,
	};
}

function cloneSpanRecord(record: TelemetrySpanRecord): TelemetrySpanRecord {
	return {
		attributes: cloneAttributes(record.attributes),
		...(record.endedAtMs === undefined ? {} : { endedAtMs: record.endedAtMs }),
		events: record.events.map(cloneEventRecord),
		id: record.id,
		name: record.name,
		...(record.parentId === undefined ? {} : { parentId: record.parentId }),
		...(record.runId === undefined ? {} : { runId: record.runId }),
		schemaVersion: 1,
		...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }),
		startedAtMs: record.startedAtMs,
		...(record.status === undefined ? {} : { status: cloneStatus(record.status) }),
		traceId: record.traceId,
		traceName: record.traceName,
	};
}

function cloneAttributes(
	attributes: Readonly<Record<string, TelemetryAttributeValue>>,
): Readonly<Record<string, TelemetryAttributeValue>> {
	const copy: Record<string, TelemetryAttributeValue> = {};
	for (const [key, value] of Object.entries(attributes)) copy[key] = cloneAttributeValue(value);
	return copy;
}

function cloneEventRecord(event: TelemetryEventRecord): TelemetryEventRecord {
	return {
		attributes: cloneAttributes(event.attributes),
		name: event.name,
		timestampMs: event.timestampMs,
	};
}

function cloneAttributeValue(value: TelemetryAttributeValue): TelemetryAttributeValue {
	if (typeof value !== "object") return value;
	return cloneContentReference(value);
}

function cloneStatus(status: TelemetrySpanStatus): TelemetrySpanStatus {
	if (status.kind === "ok") return { kind: "ok" };
	return {
		kind: "error",
		...(status.name === undefined ? {} : { name: status.name }),
		...(status.message === undefined ? {} : { message: cloneContentReference(status.message) }),
	};
}

function cloneContentReference(reference: TelemetryContentReference): TelemetryContentReference {
	if (reference.kind === "omitted") return omittedTelemetryContent;
	if (reference.kind === "hash") return { kind: "hash", algorithm: "sha256", value: reference.value };
	if (reference.kind === "redacted_excerpt") return { kind: "redacted_excerpt", text: reference.text };
	return { kind: "approved_pointer", pointer: reference.pointer };
}

let nextFallbackTraceId = 1;

function resolveTraceId(createTraceId: (() => string) | undefined): string {
	try {
		const supplied = createTraceId?.().trim();
		if (supplied) return supplied;
	} catch {
		return fallbackTraceId();
	}
	return fallbackTraceId();
}

function fallbackTraceId(): string {
	const randomId = globalThis.crypto?.randomUUID?.();
	if (randomId) return randomId;
	return `trace-${Date.now().toString(36)}-${nextFallbackTraceId++}`;
}

function readSessionId(
	name: TelemetrySpanName,
	attributes: Readonly<Record<string, TelemetryAttributeValue>>,
): string | undefined {
	if (name !== "jai.run") return undefined;
	const value = attributes.sessionId;
	return typeof value === "string" ? value : undefined;
}

function readRunId(
	name: TelemetrySpanName,
	attributes: Readonly<Record<string, TelemetryAttributeValue>>,
): string | undefined {
	if (name !== "jai.run") return undefined;
	const value = attributes.runId;
	return typeof value === "string" ? value : undefined;
}

function errorCategory(error: unknown): TelemetryErrorCategory {
	if (error instanceof Error && error.name === "AbortError") return "aborted";
	return "unknown";
}

function isTelemetryErrorCategory(value: unknown): value is TelemetryErrorCategory {
	return (
		value === "aborted" ||
		value === "cancelled" ||
		value === "internal" ||
		value === "permission" ||
		value === "protocol" ||
		value === "provider" ||
		value === "telemetry" ||
		value === "tool" ||
		value === "unknown"
	);
}
