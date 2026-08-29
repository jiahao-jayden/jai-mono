import type { TrajectoryItem, TrajectorySnapshot, TrajectoryWireError } from "./wire";

export type TrajectoryPhase = "loading" | "ready" | "reconnecting" | "cursor_expired" | "error";

export interface TrajectoryViewState {
	readonly phase: TrajectoryPhase;
	readonly snapshot?: TrajectorySnapshot;
	readonly items: readonly TrajectoryItem[];
	readonly selectedItemId?: string;
	readonly error?: TrajectoryWireError;
}

export type TrajectoryViewAction =
	| { readonly type: "load" }
	| { readonly type: "snapshot"; readonly snapshot: TrajectorySnapshot }
	| { readonly type: "item"; readonly item: TrajectoryItem }
	| { readonly type: "reconnecting" }
	| { readonly type: "error"; readonly error: TrajectoryWireError }
	| { readonly type: "select"; readonly itemId?: string };

export const initialTrajectoryViewState: TrajectoryViewState = { phase: "loading", items: [] };

export function trajectoryViewReducer(state: TrajectoryViewState, action: TrajectoryViewAction): TrajectoryViewState {
	switch (action.type) {
		case "load":
			return initialTrajectoryViewState;
		case "snapshot":
			return {
				phase: "ready",
				snapshot: action.snapshot,
				items: action.snapshot.items,
				selectedItemId: state.selectedItemId,
			};
		case "item":
			return { ...state, phase: "ready", error: undefined, items: mergeItem(state.items, action.item) };
		case "reconnecting":
			return { ...state, phase: "reconnecting", error: undefined };
		case "error":
			return {
				...state,
				phase: action.error.code === "cursor_expired" ? "cursor_expired" : "error",
				error: action.error,
			};
		case "select":
			return { ...state, selectedItemId: action.itemId };
		default:
			return assertNever(action);
	}
}

function mergeItem(items: readonly TrajectoryItem[], incoming: TrajectoryItem): readonly TrajectoryItem[] {
	const index = items.findIndex((item) => item.id === incoming.id);
	if (index < 0) return [...items, incoming];
	const current = items[index]!;
	const next =
		current.type === "live_chunk" && incoming.type === "live_chunk"
			? { ...incoming, chunk: { ...incoming.chunk, text: current.chunk.text + incoming.chunk.text } }
			: incoming;
	return items.map((item, itemIndex) => (itemIndex === index ? next : item));
}

function assertNever(value: never): never {
	throw new Error(`Unhandled trajectory view action: ${JSON.stringify(value)}`);
}
