import type { AssistantMessage, AssistantMessageEvent } from "./types";

export class EventStream<TEvent, TResult = TEvent> implements AsyncIterable<TEvent> {
	private queue: TEvent[] = [];
	private waiting: Array<(value: IteratorResult<TEvent>) => void> = [];
	private done = false;
	private resolveResult!: (result: TResult) => void;
	private rejectResult!: (error: unknown) => void;
	private finalResultPromise: Promise<TResult>;

	constructor(
		private readonly isComplete: (event: TEvent) => boolean,
		private readonly extractResult: (event: TEvent) => TResult,
	) {
		this.finalResultPromise = new Promise<TResult>((resolve, reject) => {
			this.resolveResult = resolve;
			this.rejectResult = reject;
		});
	}

	push(event: TEvent): void {
		if (this.done) return;

		const isTerminal = this.isComplete(event);
		if (isTerminal) {
			this.done = true;
			this.resolveResult(this.extractResult(event));
		}

		const waiter = this.waiting.shift();
		if (waiter) {
			waiter({ done: false, value: event });
			if (isTerminal) this.finishWaiting();
			return;
		}

		this.queue.push(event);
	}

	end(result: TResult): void {
		if (this.done) return;

		this.done = true;
		this.resolveResult(result);
		this.finishWaiting();
	}

	fail(error: unknown): void {
		if (this.done) return;

		this.done = true;
		this.rejectResult(error);
		this.finishWaiting();
	}

	result(): Promise<TResult> {
		return this.finalResultPromise;
	}

	[Symbol.asyncIterator](): AsyncIterator<TEvent> {
		return {
			next: () => {
				const event = this.queue.shift();
				if (event !== undefined) {
					return Promise.resolve({ done: false, value: event });
				}

				if (this.done) {
					return Promise.resolve({ done: true, value: undefined });
				}

				return new Promise<IteratorResult<TEvent>>((resolve) => {
					this.waiting.push(resolve);
				});
			},
		};
	}

	private finishWaiting(): void {
		for (const resolve of this.waiting.splice(0)) {
			resolve({ done: true, value: undefined });
		}
	}
}

export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type for final result");
			},
		);
	}
}

export function createAssistantMessageEventStream(): AssistantMessageEventStream {
	return new AssistantMessageEventStream();
}
