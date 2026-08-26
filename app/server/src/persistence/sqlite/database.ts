import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** One process-owned SQLite connection shared by Server adapters. */
export class ProductSqliteDatabase {
	#closed = false;

	private constructor(readonly connection: DatabaseSync) {}

	static async open(path: string): Promise<ProductSqliteDatabase> {
		if (path !== ":memory:") await mkdir(dirname(path), { recursive: true });
		return new ProductSqliteDatabase(new DatabaseSync(path));
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.connection.close();
	}
}
