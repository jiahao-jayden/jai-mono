import type { TrajectoryCursor, TrajectoryItem, TrajectorySnapshot, TrajectoryWireError } from "./wire";

export type TrajectoryDataResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: TrajectoryWireError };

export interface TrajectorySubscription {
	close(): void;
}

/** Host-owned transport seam. It intentionally knows nothing about HTTP, IPC, or credentials. */
export interface TrajectoryDataSource {
	snapshot(sessionId: string): Promise<TrajectoryDataResult<TrajectorySnapshot>>;
	subscribe(input: {
		readonly sessionId: string;
		readonly cursor: TrajectoryCursor;
		readonly onItem: (item: TrajectoryItem) => void;
		readonly onError: (error: TrajectoryWireError) => void;
	}): Promise<TrajectoryDataResult<TrajectorySubscription>>;
}
