type HookHandler = (ctx: any) => Promise<any | undefined>;

export class HookRegistry {
	private handlers = new Map<string, HookHandler[]>();

	register(name: string, handler: HookHandler): () => void {
		const list = this.handlers.get(name) ?? [];
		list.push(handler);
		this.handlers.set(name, list);

		return () => {
			const current = this.handlers.get(name);
			if (current) {
				this.handlers.set(
					name,
					current.filter((h) => h !== handler),
				);
			}
		};
	}

	hasHandlers(name: string): boolean {
		return (this.handlers.get(name)?.length ?? 0) > 0;
	}

	async run(name: string, ctx: unknown): Promise<unknown | undefined> {
		const list = this.handlers.get(name);
		if (!list || list.length === 0) return undefined;

		let currentCtx = ctx;
		let lastResult: unknown | undefined;

		for (const handler of list) {
			const result = await handler(currentCtx);
			if (result !== undefined) {
				lastResult = result;
				currentCtx = { ...(currentCtx as any), ...(result as any) };
			}
		}

		return lastResult;
	}
}
