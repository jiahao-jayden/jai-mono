import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { SessionEntry } from "../types.js";
import { BaseSessionStore } from "./base-store.js";

export class JsonlSessionStore extends BaseSessionStore {
	private filePath: string;

	private constructor(filePath: string) {
		super();
		this.filePath = filePath;
	}

	static async open(filePath: string): Promise<JsonlSessionStore> {
		const store = new JsonlSessionStore(filePath);
		await store.load();
		return store;
	}

	private async load(): Promise<void> {
		const file = Bun.file(this.filePath);
		if (!(await file.exists())) return;

		const raw = await file.text();
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				this.entries.push(JSON.parse(trimmed) as SessionEntry);
			} catch {
				// 跳过解析失败的行（crash 后最后一行可能不完整）
			}
		}
	}

	async append(entry: SessionEntry): Promise<void> {
		this.entries.push(entry);
		await mkdir(dirname(this.filePath), { recursive: true });
		await appendFile(this.filePath, `${JSON.stringify(entry)}\n`);
	}
}
