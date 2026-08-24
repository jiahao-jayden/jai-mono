import { Result, type Result as ResultType } from "better-result";
import type { CodingAgent as InternalCodingAgent } from "../runtime";
import type { sdkConfigDefinition } from "./config";
import { type CodingExtensionError, extensionHostOperationFailed } from "./extension-errors";
import type { JsonObject } from "./types";

export type CodingSchema = typeof sdkConfigDefinition.schema;

export function createExtensionSessionStateAdapter<TAppState extends JsonObject>(
	agent: InternalCodingAgent<CodingSchema, PersistedCodingSessionState<TAppState>>,
) {
	return {
		read: async (extensionId: string) => Result.ok(extensionStateFromAppState(agent.state.appState, extensionId)),
		update: async (
			extensionId: string,
			update: (current: JsonObject | undefined) => ResultType<JsonObject, CodingExtensionError>,
		) => {
			let persisted: JsonObject | undefined;
			let failure: CodingExtensionError | undefined;
			try {
				await agent.updateAppState((current) => {
					const extensions = extensionStatesFromAppState(current);
					const next = update(extensions[extensionId]);
					if (next.isErr()) {
						failure = next.error;
						// updateAppState cannot return Result, so this is the adapter seam that aborts its write.
						throw next.error;
					}
					const value = structuredClone(next.value);
					persisted = value;
					return { ...current, extensions: { ...extensions, [extensionId]: value } };
				});
			} catch (cause) {
				if (failure) return Result.err(failure);
				return Result.err(
					extensionHostOperationFailed(
						"session_state_write",
						`Extension "${extensionId}" session state could not be persisted`,
						cause,
					),
				);
			}
			if (!persisted) {
				return Result.err(
					extensionHostOperationFailed(
						"session_state_write",
						`Extension "${extensionId}" session state could not be persisted`,
					),
				);
			}
			return Result.ok(structuredClone(persisted));
		},
	};
}

export interface PersistedCodingSessionState<TAppState extends JsonObject> extends JsonObject {
	readonly version: 1;
	readonly appState: TAppState;
	readonly extensions: Readonly<Record<string, JsonObject>>;
}

export function emptyPersistedCodingSessionState<
	TAppState extends JsonObject,
>(): PersistedCodingSessionState<TAppState> {
	return {
		version: 1,
		appState: {} as TAppState,
		extensions: {},
	};
}

function extensionStateFromAppState(
	appState: PersistedCodingSessionState<JsonObject>,
	extensionId: string,
): JsonObject | undefined {
	const value = extensionStatesFromAppState(appState)[extensionId];
	return value ? structuredClone(value) : undefined;
}

function extensionStatesFromAppState(
	appState: PersistedCodingSessionState<JsonObject>,
): Readonly<Record<string, JsonObject>> {
	const value = appState.extensions;
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).flatMap(([id, state]) =>
			state && typeof state === "object" && !Array.isArray(state) ? [[id, state as JsonObject]] : [],
		),
	);
}
