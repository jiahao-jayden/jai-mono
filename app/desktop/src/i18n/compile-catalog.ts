import { execFileSync } from "node:child_process";

const compile = (input: string, output: string, format?: "simple") => {
	const args = ["compile", input, "--out-file", output];
	if (format) {
		args.push("--format", format);
	}
	execFileSync("formatjs", args, { stdio: "inherit" });
};

compile("src/i18n/messages/en.json", "src/i18n/compiled/en.json");
compile("src/i18n/messages/zh-CN.json", "src/i18n/compiled/zh-CN.json", "simple");
