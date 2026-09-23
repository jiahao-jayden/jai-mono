import type {
	TelemetryContext,
	TelemetrySpan,
	TelemetrySpanContent,
	TelemetrySpanName,
	TelemetrySpanStatus,
	TelemetryStartSpanOptions,
} from "@jai/telemetry";

/**
 * 把同一棵 span 同时交给主 context（Langfuse 或 Noop）和本地诊断 context。
 * 原文只进主 context 的 content sink，本地文件只收到安全投影。
 */
export class MirroredTelemetryContext implements TelemetryContext {
	constructor(
		private readonly primary: TelemetryContext,
		private readonly mirror: TelemetryContext,
	) {}

	get contentCaptureEnabled(): boolean {
		return this.primary.contentCaptureEnabled;
	}

	startSpan<Name extends TelemetrySpanName>(options: TelemetryStartSpanOptions<Name>): TelemetrySpan<Name> {
		const parent = options.parent instanceof MirroredTelemetrySpan ? options.parent : undefined;
		const primary = parent
			? this.primary.startSpan({ ...options, parent: parent.primary } as TelemetryStartSpanOptions<Name>)
			: this.primary.startSpan(options);
		const mirror = parent
			? this.mirror.startSpan({ ...options, parent: parent.mirror } as TelemetryStartSpanOptions<Name>)
			: this.mirror.startSpan({
					name: options.name,
					attributes: options.attributes,
				} as TelemetryStartSpanOptions<Name>);
		return new MirroredTelemetrySpan(primary, mirror);
	}
}

class MirroredTelemetrySpan<Name extends TelemetrySpanName> implements TelemetrySpan<Name> {
	constructor(
		readonly primary: TelemetrySpan<Name>,
		readonly mirror: TelemetrySpan<Name>,
	) {}

	get id(): string {
		return this.primary.id;
	}

	get name(): Name {
		return this.primary.name;
	}

	get contentCaptureEnabled(): boolean {
		return this.primary.contentCaptureEnabled;
	}

	addEvent(event: Parameters<TelemetrySpan<Name>["addEvent"]>[0]): void {
		this.primary.addEvent(event);
		this.mirror.addEvent(event);
	}

	recordContent(content: TelemetrySpanContent): void {
		this.primary.recordContent(content);
	}

	setAttributes(attributes: Parameters<TelemetrySpan<Name>["setAttributes"]>[0]): void {
		this.primary.setAttributes(attributes);
		this.mirror.setAttributes(attributes);
	}

	setStatus(status: TelemetrySpanStatus): void {
		this.primary.setStatus(status);
		this.mirror.setStatus(status);
	}
}
