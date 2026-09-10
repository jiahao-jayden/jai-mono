import { CodingConfigStore, type JsonObject, sdkConfigDefinition } from "@jai/coding-agent";
import {
	type McpServerStatus,
	probeMcpServers,
	resolveMcpConfiguration,
	validateRawMcpConfiguration,
} from "@jai/extension/mcp";
import { Result, type Result as ResultType, TaggedError } from "better-result";

export interface RuntimeMcpSettingsSnapshot {
	readonly revision: string | null;
	readonly mcp: JsonObject | undefined;
}

export interface RuntimeMcpSettingsInput {
	readonly revision: string | null;
	readonly mcp: JsonObject;
}

export class RuntimeMcpSettingsInvalid extends TaggedError("runtime_mcp.settings_invalid")<{
	readonly message: string;
}> {}

export class RuntimeMcpSettingsReadFailed extends TaggedError("runtime_mcp.read_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class RuntimeMcpSettingsWriteFailed extends TaggedError("runtime_mcp.write_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class RuntimeMcpSettingsWriteConflict extends TaggedError("runtime_mcp.write_conflict")<{
	readonly data: { readonly expectedRevision: string | null; readonly actualRevision: string | null };
	readonly message: string;
}> {}

export type RuntimeMcpSettingsWriteError =
	| RuntimeMcpSettingsInvalid
	| RuntimeMcpSettingsWriteConflict
	| RuntimeMcpSettingsWriteFailed;

/** Server owner for the MCP slice of the shared user settings document. */
export class RuntimeMcpSettingsController {
	readonly #config: CodingConfigStore<typeof sdkConfigDefinition.schema>;

	constructor(options: { readonly homeDirectory: string }) {
		this.#config = new CodingConfigStore(sdkConfigDefinition, { homeDir: options.homeDirectory });
	}

	async snapshot(): Promise<ResultType<RuntimeMcpSettingsSnapshot, RuntimeMcpSettingsReadFailed>> {
		try {
			const current = await this.#config.readScope("user");
			const mcp = Reflect.get(current.settings, "mcp");
			if (mcp !== undefined && (typeof mcp !== "object" || mcp === null || Array.isArray(mcp))) {
				return Result.err(new RuntimeMcpSettingsReadFailed({ message: "MCP configuration must be an object" }));
			}
			return Result.ok({
				revision: current.revision,
				mcp: mcp as JsonObject | undefined,
			});
		} catch (cause) {
			return Result.err(new RuntimeMcpSettingsReadFailed({ message: "Could not read MCP configuration", cause }));
		}
	}

	async save(
		input: RuntimeMcpSettingsInput,
	): Promise<ResultType<RuntimeMcpSettingsSnapshot, RuntimeMcpSettingsWriteError>> {
		const validated = validateRawMcpConfiguration(input.mcp);
		if (validated.isErr()) {
			return Result.err(new RuntimeMcpSettingsInvalid({ message: validated.error.message }));
		}
		try {
			const current = await this.#config.readScope("user");
			const rest = stripMcp(current.settings as Record<string, unknown>);
			await this.#config.writeScopeRaw(
				"user",
				{ ...rest, mcp: validated.value },
				{
					expectedRevision: input.revision,
				},
			);
		} catch (cause) {
			if (isConfigWriteConflict(cause)) {
				return Result.err(
					new RuntimeMcpSettingsWriteConflict({
						message: "MCP configuration changed before it could be saved",
						data: {
							expectedRevision: input.revision,
							actualRevision: cause.data.actualRevision,
						},
					}),
				);
			}
			if (TaggedError.is(cause))
				return Result.err(new RuntimeMcpSettingsWriteFailed({ message: cause.message, cause }));
			return Result.err(new RuntimeMcpSettingsWriteFailed({ message: "Could not save MCP configuration", cause }));
		}
		const after = await this.snapshot();
		if (after.isErr()) return Result.err(new RuntimeMcpSettingsWriteFailed({ message: after.error.message }));
		return after;
	}

	async status(): Promise<ResultType<{ readonly servers: readonly McpServerStatus[] }, RuntimeMcpSettingsReadFailed>> {
		const snapshot = await this.snapshot();
		if (snapshot.isErr()) return snapshot;
		if (snapshot.value.mcp === undefined) return Result.ok({ servers: [] });
		const resolved = resolveMcpConfiguration({ user: snapshot.value.mcp });
		if (resolved.isErr()) return Result.ok({ servers: [] });
		const probed = await probeMcpServers(resolved.value);
		return Result.ok({ servers: probed.unwrap().servers });
	}

	close(): void {
		this.#config.close();
	}
}

function stripMcp(settings: Record<string, unknown>): Record<string, unknown> {
	const { mcp: _mcp, ...rest } = settings;
	return rest;
}

function isConfigWriteConflict(cause: unknown): cause is Error & {
	readonly _tag: "coding_config.write_conflict";
	readonly data: { readonly actualRevision: string | null };
} {
	if (!TaggedError.is(cause) || cause._tag !== "coding_config.write_conflict") return false;
	const data = (cause as { readonly data?: unknown }).data;
	return (
		typeof data === "object" &&
		data !== null &&
		"actualRevision" in data &&
		(data.actualRevision === null || typeof data.actualRevision === "string")
	);
}
