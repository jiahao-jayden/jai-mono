import type {
	TelemetryContext,
	TelemetryEventInput,
	TelemetryEventNameForSpan,
	TelemetrySpan,
	TelemetrySpanContent,
	TelemetrySpanName,
	TelemetrySpanStatus,
	TelemetryStartSpanOptions,
} from "../core/contracts";

/** 产品默认实现：保留端口形状，但不分配记录、队列或输出。 */
export class NoopTelemetryContext implements TelemetryContext {
	readonly contentCaptureEnabled = false;

	startSpan<Name extends TelemetrySpanName>(options: TelemetryStartSpanOptions<Name>): TelemetrySpan<Name> {
		void options;
		return new NoopTelemetrySpan(options.name);
	}
}

class NoopTelemetrySpan<Name extends TelemetrySpanName> implements TelemetrySpan<Name> {
	readonly contentCaptureEnabled = false;
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

	recordContent(content: TelemetrySpanContent): void {
		void content;
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
