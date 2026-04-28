import { describe, expect, test } from "bun:test";
import { TypedEmitter } from "../src/typed-emitter";

type Foo = { kind: "foo"; n: number };

describe("TypedEmitter", () => {
	test("emit fans out to all subscribers", () => {
		const bus = new TypedEmitter<Foo>();
		const seen: number[] = [];
		bus.subscribe((e) => seen.push(e.n));
		bus.subscribe((e) => seen.push(e.n * 10));

		bus.emit({ kind: "foo", n: 3 });

		expect(seen).toEqual([3, 30]);
	});

	test("subscribe returns unsubscribe function", () => {
		const bus = new TypedEmitter<Foo>();
		const seen: number[] = [];
		const off = bus.subscribe((e) => seen.push(e.n));

		bus.emit({ kind: "foo", n: 1 });
		off();
		bus.emit({ kind: "foo", n: 2 });

		expect(seen).toEqual([1]);
		expect(bus.listenerCount).toBe(0);
	});

	test("listener error does not break siblings or future emits", () => {
		const bus = new TypedEmitter<Foo>();
		const seen: number[] = [];
		const originalError = console.error;
		console.error = () => {};
		try {
			bus.subscribe(() => {
				throw new Error("boom");
			});
			bus.subscribe((e) => seen.push(e.n));

			bus.emit({ kind: "foo", n: 1 });
			bus.emit({ kind: "foo", n: 2 });
		} finally {
			console.error = originalError;
		}

		expect(seen).toEqual([1, 2]);
	});

	test("listenerCount reflects subscriptions", () => {
		const bus = new TypedEmitter<Foo>();
		expect(bus.listenerCount).toBe(0);

		const off1 = bus.subscribe(() => {});
		const off2 = bus.subscribe(() => {});
		expect(bus.listenerCount).toBe(2);

		off1();
		expect(bus.listenerCount).toBe(1);
		off2();
		expect(bus.listenerCount).toBe(0);
	});

	test("subclass usage with phantom types", () => {
		class StatusBus extends TypedEmitter<{ name: string; ready: boolean }> {}
		const bus = new StatusBus();
		const seen: string[] = [];
		bus.subscribe((s) => seen.push(`${s.name}:${s.ready}`));
		bus.emit({ name: "a", ready: true });
		bus.emit({ name: "b", ready: false });
		expect(seen).toEqual(["a:true", "b:false"]);
	});
});
