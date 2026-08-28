import { execSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getNpmPackageName } from "@ff-labs/fff-node";

const require = createRequire(import.meta.url);
const destination = join(import.meta.dirname, "..", "dist", "node_modules");
const fffDirectory = dirname(require.resolve("@ff-labs/fff-node/package.json"));
const fffRequire = createRequire(join(fffDirectory, "package.json"));
const ffiDirectory = dirname(fffRequire.resolve("ffi-rs/package.json"));
const ffiRequire = createRequire(join(ffiDirectory, "package.json"));

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

await stagePackage("@ff-labs/fff-node", fffDirectory);
await stagePackage(getNpmPackageName(), dirname(fffRequire.resolve(`${getNpmPackageName()}/package.json`)));
await stagePackage("ffi-rs", ffiDirectory);
await stagePackage(ffiBindingPackage(), dirname(ffiRequire.resolve(`${ffiBindingPackage()}/package.json`)));

async function stagePackage(packageName: string, packageDirectory: string): Promise<void> {
	await cp(packageDirectory, join(destination, packageName), { recursive: true });
}

function ffiBindingPackage(): string {
	if (process.platform === "darwin") return `@yuuang/ffi-rs-darwin-${process.arch}`;
	if (process.platform === "win32") return `@yuuang/ffi-rs-win32-${process.arch}-msvc`;
	if (process.platform === "linux") {
		const architecture = process.arch === "x64" ? "x64" : "arm64";
		return `@yuuang/ffi-rs-linux-${architecture}-${usesMusl() ? "musl" : "gnu"}`;
	}
	throw new Error(`FFF does not support ${process.platform}/${process.arch}`);
}

function usesMusl(): boolean {
	try {
		return execSync("ldd --version 2>&1", { encoding: "utf8", timeout: 5_000 }).toLowerCase().includes("musl");
	} catch (error) {
		const output = error instanceof Error && "stdout" in error ? String(error.stdout ?? "") : "";
		return output.toLowerCase().includes("musl");
	}
}
