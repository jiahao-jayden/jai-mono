import type { FileSystem } from "../environment";

const queues = new WeakMap<FileSystem, Map<string, Promise<void>>>();

export async function withFileMutationQueue<T>(
	fileSystem: FileSystem,
	canonicalPath: string,
	operation: () => Promise<T>,
): Promise<T> {
	let fileSystemQueues = queues.get(fileSystem);
	if (!fileSystemQueues) {
		fileSystemQueues = new Map();
		queues.set(fileSystem, fileSystemQueues);
	}
	const previous = fileSystemQueues.get(canonicalPath) ?? Promise.resolve();
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tail = previous.then(() => gate);
	fileSystemQueues.set(canonicalPath, tail);
	await previous;
	try {
		return await operation();
	} finally {
		release();
		if (fileSystemQueues.get(canonicalPath) === tail) fileSystemQueues.delete(canonicalPath);
	}
}
