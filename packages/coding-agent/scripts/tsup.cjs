const Module = require("node:module");
const path = require("node:path");

const pkgDir = path.join(__dirname, "..");
const requireFromPkg = Module.createRequire(path.join(pkgDir, "package.json"));

async function main() {
	const { build } = requireFromPkg("tsup");
	await build({});
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
