/**
 * 类型安全的单事件流 pub/sub。
 *
 * 子类化 / 泛型实例化两种用法：
 *
 *   class MyBus extends TypedEmitter<MyEvent> {}
 *   const bus = new TypedEmitter<MyEvent>();
 *
 * listener 抛错不会影响其他 listener；错误会写到 stderr（不静默吞）。
 */
export class TypedEmitter<E> {
	private listeners = new Set<(event: E) => void>();

	subscribe(listener: (event: E) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(event: E): void {
		for (const l of this.listeners) {
			try {
				l(event);
			} catch (err) {
				console.error("[TypedEmitter] listener error:", err);
			}
		}
	}

	get listenerCount(): number {
		return this.listeners.size;
	}
}
