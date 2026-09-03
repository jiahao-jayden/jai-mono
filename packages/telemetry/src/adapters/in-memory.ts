import type {
	TelemetryContext,
	TelemetryContextOptions,
	TelemetrySpan,
	TelemetrySpanName,
	TelemetrySpanRecord,
	TelemetryStartSpanOptions,
} from "../core/contracts";
import { createTelemetryContext } from "../runtime/telemetry-context";

/** 仅供测试断言因果结构；产品宿主不得使用它作为历史或读取模型。 */
export class InMemoryTelemetryContext implements TelemetryContext {
	readonly #context: TelemetryContext;
	readonly #records = new Map<string, TelemetrySpanRecord>();

	constructor(options: Pick<TelemetryContextOptions, "createTraceId" | "now"> = {}) {
		const records = this.#records;
		const onSpanStateChange = (record: TelemetrySpanRecord): void => {
			records.set(record.id, record);
			return;
		};
		this.#context = createTelemetryContext({ ...options, onSpanStateChange });
	}

	get spans(): readonly TelemetrySpanRecord[] {
		return [...this.#records.values()];
	}

	get contentCaptureEnabled(): boolean {
		return this.#context.contentCaptureEnabled;
	}

	startSpan<Name extends TelemetrySpanName>(options: TelemetryStartSpanOptions<Name>): TelemetrySpan<Name> {
		return this.#context.startSpan(options);
	}

	async waitForSettledSpans(): Promise<void> {
		await Promise.resolve();
		await Promise.resolve();
		return;
	}
}
