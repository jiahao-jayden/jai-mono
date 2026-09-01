export function hasRuntimeTelemetryEnvironmentOverride(
	environment: Readonly<Record<string, string | undefined>>,
): boolean {
	return Object.keys(environment).some((name) => name.startsWith("JAI_TELEMETRY_") && environment[name] !== undefined);
}
