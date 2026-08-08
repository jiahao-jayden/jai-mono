import { ConnectorRuntimeConfigInvalid } from "../errors";
import { createDefaultConnectorService } from "../providers";
import type { ConnectorConfigStore } from "../types";
import { startManagedConnectorService } from "./index";

export interface ConnectorServiceProcessOptions {
	readonly configStore: ConnectorConfigStore;
	readonly discoveryFile?: string;
	readonly runtimeTokenFile?: string;
	readonly logDirectory?: string;
	readonly homeDirectory?: string;
}

export async function runConnectorServiceProcess(options: ConnectorServiceProcessOptions): Promise<void> {
	const loaded = await options.configStore.load();
	if (loaded.isErr()) throw loaded.error;
	if (loaded.value.settings.enabled === false) {
		throw new ConnectorRuntimeConfigInvalid({
			message: "Connector Service is disabled in user settings",
			data: { reason: "disabled" },
		});
	}
	const service = createDefaultConnectorService(loaded.value.settings);
	let stopped = false;
	let resolveStopped: (() => void) | undefined;
	const stoppedPromise = new Promise<void>((resolve) => {
		resolveStopped = resolve;
	});
	const stop = () => {
		if (stopped) return;
		stopped = true;
		resolveStopped?.();
	};
	const stopConfigWatch = options.configStore.watch((event) => {
		if (event.status !== "valid") return;
		if (event.snapshot.settings.enabled === false) {
			stop();
			return;
		}
		service.applyConfiguration(createDefaultConnectorService(event.snapshot.settings));
	});
	const started = await startManagedConnectorService(service, {
		homeDirectory: options.homeDirectory,
		paths: {
			...(options.discoveryFile ? { discoveryFile: options.discoveryFile } : {}),
			...(options.runtimeTokenFile ? { runtimeTokenFile: options.runtimeTokenFile } : {}),
			...(options.logDirectory ? { logDirectory: options.logDirectory } : {}),
		},
	});
	if (started.isErr()) {
		stopConfigWatch();
		options.configStore.close();
		throw started.error;
	}
	const runtime = started.value;
	const close = () => stop();
	process.once("SIGINT", close);
	process.once("SIGTERM", close);
	await stoppedPromise;
	process.off("SIGINT", close);
	process.off("SIGTERM", close);
	stopConfigWatch();
	await runtime.close();
	options.configStore.close();
}
