import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

const browser = join(import.meta.dirname, "..", "..", "trajectory-browser");
const destination = join(import.meta.dirname, "..", "dist", "trajectory-browser");

await Bun.$`bun run build`.cwd(browser).quiet();
await rm(destination, { recursive: true, force: true });
await cp(join(browser, "dist"), destination, { recursive: true });
