import type { AgentTool } from "@jai/agent";
import { Type } from "@sinclair/typebox";

export const REPORT_PROGRESS_TOOL_NAME = "ReportProgress";

const reportProgressParameters = Type.Object(
	{
		title: Type.String({
			minLength: 1,
			maxLength: 80,
			description: "Present-participle work title, at most six words.",
		}),
		detail: Type.String({
			minLength: 1,
			maxLength: 300,
			description: "One concise sentence describing the next work step.",
		}),
	},
	{ additionalProperties: false },
);

export function createReportProgressTool(): AgentTool<typeof reportProgressParameters> {
	return {
		name: REPORT_PROGRESS_TOOL_NAME,
		label: "Progress",
		description:
			"MANDATORY before any other work tool. Report a concise user-visible description of the next work step.",
		parameters: reportProgressParameters,
		executionMode: "parallel",
		async execute() {
			return { content: [{ type: "text", text: "Progress reported." }] };
		},
	};
}
