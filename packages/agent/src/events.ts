import type { AgentEvent } from "./types.js";

type Subscriber = (event: AgentEvent) => void;

export class EventBus {
	private subscribers: Subscriber[] = [];

	subscribe(callback: Subscriber): () => void {
		this.subscribers.push(callback);
		return () => {
			this.subscribers = this.subscribers.filter((cb) => cb !== callback);
		};
	}

	emit(event: AgentEvent): void {
		for (const callback of this.subscribers) {
			callback(event);
		}
	}
}
