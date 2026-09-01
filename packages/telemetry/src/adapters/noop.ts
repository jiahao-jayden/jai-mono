import type {
	TelemetryContext,
	TelemetryEventInput,
	TelemetryEventNameForSpan,
	TelemetrySpan,
	TelemetrySpanName,
	TelemetrySpanStatus,
	TelemetryStartSpanOptions,
} from "../core/contracts";

/** 产品默认实现：保留端口形状，但不分配记录、队列或输出。 */
export class NoopTelemetryContext implements TelemetryContext {
	startSpan<Name extends TelemetrySpanName>(options: TelemetryStartSpanOptions<Name>): TelemetrySpan<Name> {
		void options;
		return new NoopTelemetrySpan(options.name);
	}
}

class NoopTelemetrySpan<Name extends TelemetrySpanName> implements TelemetrySpan<Name> {
	readonly id: string;
	readonly name: Name;

	constructor(name: Name) {
		this.id = `noop:${name}`;
		this.name = name;
	}

	addEvent<EventName extends TelemetryEventNameForSpan<Name>>(event: TelemetryEventInput<EventName>): void {
		void event;
		return;
	}

	setAttributes(attributes: Parameters<TelemetrySpan<Name>["setAttributes"]>[0]): void {
		void attributes;
		return;
	}

	setStatus(status: TelemetrySpanStatus): void {
		void status;
		return;
	}
}
