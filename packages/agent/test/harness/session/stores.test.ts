import { InMemorySessionStore } from "../../../src/harness";
import {
	describeSessionStoreContract,
	type SessionStoreContractHarness,
} from "../../support/session-store-contract";
import type { AppState } from "../../support/fixtures";

const harnesses: SessionStoreContractHarness[] = [
	{
		name: "InMemorySessionStore",
		create: async () => new InMemorySessionStore<AppState>(),
		cleanup: async () => {},
	},
];

for (const harness of harnesses) describeSessionStoreContract(harness);
