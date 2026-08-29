import { useEffect, useReducer } from "react";
import type { TrajectoryDataSource, TrajectorySubscription } from "./source";
import { initialTrajectoryViewState, trajectoryViewReducer } from "./state";
import type { TrajectoryWireError } from "./wire";

const reconnectDelayMs = 1_000;

export function useTrajectory(source: TrajectoryDataSource, sessionId: string) {
	const [state, dispatch] = useReducer(trajectoryViewReducer, initialTrajectoryViewState);
	useEffect(() => {
		let disposed = false;
		let loadedSnapshot = false;
		let subscription: TrajectorySubscription | undefined;
		let reconnect: ReturnType<typeof setTimeout> | undefined;
		const stop = () => {
			if (reconnect) clearTimeout(reconnect);
			subscription?.close();
		};
		const connect = async () => {
			if (!loadedSnapshot) dispatch({ type: "load" });
			const snapshot = await source.snapshot(sessionId);
			if (disposed) return;
			if (!snapshot.ok) {
				dispatch({ type: "error", error: snapshot.error });
				return;
			}
			dispatch({ type: "snapshot", snapshot: snapshot.value });
			loadedSnapshot = true;
			const observed = await source.subscribe({
				sessionId,
				cursor: snapshot.value.cursor,
				onItem: (item) => dispatch({ type: "item", item }),
				onError: (error) => recover(error),
			});
			if (disposed) {
				if (observed.ok) observed.value.close();
				return;
			}
			if (!observed.ok) recover(observed.error);
			else subscription = observed.value;
		};
		const recover = (error: TrajectoryWireError) => {
			if (disposed) return;
			subscription?.close();
			subscription = undefined;
			if (error.code === "cursor_expired") dispatch({ type: "error", error });
			else dispatch({ type: "reconnecting" });
			reconnect = setTimeout(() => void connect(), reconnectDelayMs);
		};
		void connect();
		return () => {
			disposed = true;
			stop();
		};
	}, [source, sessionId]);
	return [state, dispatch] as const;
}
