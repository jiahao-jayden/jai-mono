/**
 * Durable cache of the models discovered for each configured Provider profile.
 *
 * Provider configuration owns this data: session and project metadata must not
 * know how a Provider's model list is fetched, stored, or renamed.
 */
export interface ProviderModelInventory {
	readonly profileId: string;
	readonly modelIds: readonly string[];
	readonly fetchedAt: number;
}

export interface ProviderModelInventoryStore {
	get(profileId: string): ProviderModelInventory | undefined;
	replace(profileId: string, modelIds: readonly string[]): ProviderModelInventory;
	delete(profileId: string): void;
	rename(fromProfileId: string, toProfileId: string): void;
}
