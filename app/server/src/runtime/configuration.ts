import { TaggedError } from "better-result";

/** A required Runtime Host configuration is missing or cannot be used safely. */
export class RuntimeHostConfigurationInvalid extends TaggedError("runtime_host.configuration_invalid")<{
	readonly message: string;
}> {}
