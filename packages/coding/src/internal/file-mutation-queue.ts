const queues = new Map<string, Promise<void>>();

export async function withFileMutationQueue<T>(absolutePath: string, operation: () => Promise<T>): Promise<T> {
	const previous = queues.get(absolutePath) ?? Promise.resolve();
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tail = previous.then(() => gate);
	queues.set(absolutePath, tail);

	await previous;
	try {
		return await operation();
	} finally {
		release();
		if (queues.get(absolutePath) === tail) queues.delete(absolutePath);
	}
}
