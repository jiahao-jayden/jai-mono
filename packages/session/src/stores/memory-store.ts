import type { SessionEntry } from "../types.js";
import { BaseSessionStore } from "./base-store.js";

export class InMemorySessionStore extends BaseSessionStore {
	append(entry: SessionEntry): Promise<void> {
		this.entries.push(entry);
		return Promise.resolve();
	}
}
