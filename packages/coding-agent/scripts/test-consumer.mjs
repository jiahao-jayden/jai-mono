import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const execFile = promisify(execFileCallback);
const packageDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const documentationDirectory = join(packageDirectory, "../../app/docs/content/docs");
const require = createRequire(import.meta.url);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "jai-coding-agent-consumer-"));
const npmCacheDirectory = join(temporaryDirectory, "npm-cache");

try {
	await runNpm(["pack", "--pack-destination", temporaryDirectory], {
		cwd: packageDirectory,
	});
	const archive = (await readdir(temporaryDirectory)).find((name) => name.endsWith(".tgz"));
	if (!archive) throw new Error("npm pack did not create a tarball");

	const consumerDirectory = join(temporaryDirectory, "consumer");
	await writeFile(
		join(temporaryDirectory, "package.json"),
		JSON.stringify({ private: true, type: "module" }),
	);
	await runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", `./${archive}`], {
		cwd: temporaryDirectory,
	});
	await mkdir(consumerDirectory);
	await writeFile(
		join(consumerDirectory, "index.ts"),
		[
			'import { createCodingAgent, type CodingAgentCreateOptions } from "@jai/coding-agent";',
			'const options = { model: "anthropic/claude-sonnet-4-20250514" } satisfies CodingAgentCreateOptions;',
			"void createCodingAgent(options);",
		].join("\n"),
	);
	const documentationExamples = await compiledDocumentationExamples();
	if (documentationExamples.length === 0) {
		throw new Error("No documentation examples were marked for compilation");
	}
	await Promise.all(
		documentationExamples.map((example, index) =>
			writeFile(join(consumerDirectory, `docs-example-${index + 1}.ts`), example),
		),
	);
	await writeFile(
		join(consumerDirectory, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				module: "NodeNext",
				moduleResolution: "NodeNext",
				target: "ES2022",
				strict: true,
				noEmit: true,
			},
		}),
	);
	await execFile(process.execPath, [require.resolve("typescript/bin/tsc"), "--project", "tsconfig.json"], {
		cwd: consumerDirectory,
	});
	await writeFile(
		join(consumerDirectory, "runtime.mjs"),
		[
			'import { createCodingAgent } from "@jai/coding-agent";',
			'const result = await createCodingAgent({ model: "unsupported/model" });',
			'if (!result.isErr()) throw new Error("Expected a public SDK error result");',
		].join("\n"),
	);
	await execFile(process.execPath, ["runtime.mjs"], { cwd: consumerDirectory });
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}

async function compiledDocumentationExamples() {
	const files = (await documentationFiles(documentationDirectory)).sort();
	const examples = await Promise.all(
		files.map(async (file) => documentationExamples(await readFile(file, "utf8"))),
	);
	return examples.flat();
}

async function documentationFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map((entry) => {
			const file = join(directory, entry.name);
			if (entry.isDirectory()) return documentationFiles(file);
			return entry.name.endsWith(".mdx") ? [file] : [];
		}),
	);
	return files.flat();
}

function documentationExamples(document) {
	return [...document.matchAll(/```ts[^\n]*\n([\s\S]*?)```/g)]
		.map((match) => match[1])
		.filter((example) => example.includes("// @docs-compile"));
}

function runNpm(arguments_, options) {
	return execFile("npm", arguments_, {
		...options,
		env: { ...process.env, npm_config_cache: npmCacheDirectory },
	});
}
