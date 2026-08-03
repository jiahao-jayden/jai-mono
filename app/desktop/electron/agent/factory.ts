import type { AgentMessage } from "@jai/agent";
import type { CodingBusinessService } from "@jai/coding/business";
import {
	codingAgentConfigDefinition,
	createCodingAgent,
	type ResolvedCodingProvider,
	resolveConfiguredAgentRuntime,
	resolveConfiguredProvider,
} from "@jai/coding/runtime";
import { TaggedError } from "better-result";
import { desktopModelCatalog } from "../model-catalog";
import type { DesktopAgentFactory, HostedCodingAgent } from "./host";

const CODING_AGENT_INSTRUCTIONS =
	"You are Jai, a coding agent. Inspect the workspace before editing, keep changes scoped, and explain the result clearly.";
type DesktopProviderErrorInit = { readonly message: string };
class TitleGenerationFailed extends TaggedError("desktop_provider.title_generation_failed")<DesktopProviderErrorInit> {}
class ProviderRuntimeUnavailable extends TaggedError(
	"desktop_provider.runtime_unavailable",
)<DesktopProviderErrorInit> {}

function desktopProviderError(
	reason: "title_generation_failed" | "runtime_unavailable",
	init: DesktopProviderErrorInit,
) {
	switch (reason) {
		case "title_generation_failed":
			return new TitleGenerationFailed(init);
		case "runtime_unavailable":
			return new ProviderRuntimeUnavailable(init);
	}
}

export function createDesktopAgentFactory(service: CodingBusinessService): DesktopAgentFactory {
	return async ({ sessionId, modelRef, requestApproval }) => {
		const session = service.getSession(sessionId);
		const executionContext = await service.resolveExecutionContext(sessionId);
		let resolvedProvider: ResolvedCodingProvider | undefined;
		const codingAgent = await createCodingAgent({
			executionContext,
			sessionId,
			sessionDirectory: service.sessionDirectory(session.workspaceId),
			instructions: CODING_AGENT_INSTRUCTIONS,
			resolveInstructions(snapshot) {
				return withLanguageInstruction(CODING_AGENT_INSTRUCTIONS, snapshot.settings.agent?.language);
			},
			configDefinition: codingAgentConfigDefinition,
			configOptions: {
				workspaceTrusted: executionContext.localFileAccess,
			},
			resolveProvider(snapshot) {
				const profileId = modelRef.slice(0, modelRef.indexOf("/"));
				const inventory = profileId ? service.getProviderModelInventory(profileId) : undefined;
				const resolved = resolveConfiguredProvider(
					snapshot.settings,
					modelRef,
					desktopModelCatalog.cached?.catalog,
					{
						...(inventory ? { availableModelIds: inventory.modelIds } : {}),
						requireVerifiedCapabilities: true,
					},
				);
				resolvedProvider = resolved;
				return resolved;
			},
			resolveAgentOptions(snapshot, resolved) {
				const runtime = resolveConfiguredAgentRuntime(snapshot.settings, resolved);
				return {
					maxIterations: runtime.maxIterations,
					providerOptions: runtime.providerOptions,
				};
			},
			permissions: { requestApproval },
		});

		return {
			invoke: (input) => codingAgent.invoke(input),
			subscribe: (listener) => codingAgent.subscribe(listener),
			waitForIdle: () => codingAgent.waitForIdle(),
			abort: () => codingAgent.abort(),
			steer: (message) => codingAgent.steer(message),
			followUp: (message) => codingAgent.followUp(message),
			close: () => codingAgent.close(),
			generateTitle: (firstMessage, messages) =>
				generateSessionTitle(requireResolvedProvider(resolvedProvider), firstMessage, messages),
		} satisfies HostedCodingAgent;
	};
}

function withLanguageInstruction(instructions: string, language: string | undefined): string {
	if (!language) return instructions;
	return `${instructions}\n\nRespond in ${language} unless the user explicitly requests another language.`;
}

async function generateSessionTitle(
	runtime: ResolvedCodingProvider,
	firstMessage: string,
	messages: readonly AgentMessage[],
): Promise<string> {
	const assistantText = messages
		.filter((message) => message.role === "assistant")
		.flatMap((message) => message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])))
		.join("\n")
		.slice(0, 2_000);
	const stream = runtime.provider.stream(
		runtime.model,
		{
			systemPrompt:
				"Generate a concise session title of at most 8 words. Return only the title, without quotes or punctuation.",
			messages: [
				{
					role: "user",
					content: `User request:\n${firstMessage.slice(0, 2_000)}\n\nAssistant response:\n${assistantText}`,
					timestamp: Date.now(),
				},
			],
			tools: [],
		},
		{ temperature: 0, maxTokens: 32 },
	);
	const result = await stream.result();
	if (result.stopReason === "error" || result.stopReason === "aborted") {
		throw desktopProviderError("title_generation_failed", {
			message: "Session title generation failed",
		});
	}
	return result.content
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("")
		.trim()
		.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
}

function requireResolvedProvider(runtime: ResolvedCodingProvider | undefined): ResolvedCodingProvider {
	if (runtime) return runtime;
	throw desktopProviderError("runtime_unavailable", {
		message: "Provider runtime is unavailable",
	});
}
