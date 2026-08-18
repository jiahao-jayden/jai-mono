import {
	ConnectorConfigConflict,
	ConnectorConfigReadFailed,
	type ConnectorConfigSnapshot,
	type ConnectorConfigStore,
	ConnectorConfigWriteFailed,
	type ConnectorSettings,
} from "@jai/connector";
import { Result } from "better-result";
import { CodingConfigStore, type CodingConfigStoreOptions, type ConfigWatchEvent } from "../config";
import { type CodingAgentSettings, codingAgentConfigDefinition } from "../runtime/provider-config";

export type CodingConnectorConfigStoreOptions = CodingConfigStoreOptions;

export function createCodingConnectorConfigStore(
	options: CodingConnectorConfigStoreOptions = {},
): ConnectorConfigStore {
	return new CodingConnectorConfigStore(new CodingConfigStore(codingAgentConfigDefinition, options));
}

class CodingConnectorConfigStore implements ConnectorConfigStore {
	constructor(private readonly codingStore: CodingConfigStore<typeof codingAgentConfigDefinition.schema>) {}

	async load() {
		try {
			return Result.ok(toConnectorSnapshot(await this.codingStore.load()));
		} catch (cause) {
			return Result.err(
				new ConnectorConfigReadFailed({
					message: "Connector settings could not be read",
					data: { path: this.codingStore.paths.user, reason: "read_failed" },
					cause,
				}),
			);
		}
	}

	async save(settings: ConnectorSettings, options: { readonly expectedRevision: string | null }) {
		try {
			const current = await this.codingStore.readScope("user");
			const snapshot = await this.codingStore.writeScope(
				"user",
				{ ...current.settings, connector: settings as unknown as CodingAgentSettings["connector"] },
				{ expectedRevision: options.expectedRevision },
			);
			return Result.ok(toConnectorSnapshot(snapshot));
		} catch (cause) {
			const conflict = conflictFrom(cause, options.expectedRevision);
			if (conflict) return Result.err(conflict);
			return Result.err(
				new ConnectorConfigWriteFailed({
					message: "Connector settings could not be written",
					data: { path: this.codingStore.paths.user, reason: "write_failed" },
					cause,
				}),
			);
		}
	}

	watch(listener: Parameters<ConnectorConfigStore["watch"]>[0]): () => void {
		return this.codingStore.watch((event) => listener(toConnectorWatchEvent(event)));
	}

	close(): void {
		this.codingStore.close();
	}
}

function toConnectorSnapshot(
	snapshot: Awaited<ReturnType<CodingConfigStore<typeof codingAgentConfigDefinition.schema>["load"]>>,
): ConnectorConfigSnapshot {
	return {
		settings: snapshot.settings.connector ?? {},
		revision: snapshot.scopeRevisions.user,
	};
}

function toConnectorWatchEvent(event: ConfigWatchEvent<typeof codingAgentConfigDefinition.schema>) {
	if (event.status === "valid") return { status: "valid" as const, snapshot: toConnectorSnapshot(event.snapshot) };
	return {
		status: "invalid" as const,
		error: new ConnectorConfigReadFailed({
			message: "Connector settings became invalid",
			data: { reason: "watch_invalid" },
			cause: event.error,
		}),
		...(event.lastValid ? { lastValid: toConnectorSnapshot(event.lastValid) } : {}),
	};
}

function conflictFrom(error: unknown, expectedRevision: string | null): ConnectorConfigConflict | undefined {
	if (!isRecord(error) || !isRecord(error.data)) return undefined;
	const actualRevision = error.data.actualRevision;
	if (actualRevision !== null && typeof actualRevision !== "string") return undefined;
	if (!("expectedRevision" in error.data) && !("actualRevision" in error.data)) return undefined;
	return new ConnectorConfigConflict({
		message: "Connector settings changed before the write completed",
		data: { expectedRevision, actualRevision: actualRevision ?? null },
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
