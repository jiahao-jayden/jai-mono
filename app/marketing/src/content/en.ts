import type { LandingCopy } from "./types";

export const en = {
	meta: {
		title: "PandaWork — a calm, local-first AI coding agent for your desktop",
		description:
			"PandaWork is a local-first desktop AI coding agent. Talk to it, and it reads, writes and runs commands in your project — with your approval, on your machine, with the model you choose.",
	},
	nav: {
		features: "Features",
		models: "Models",
		privacy: "Privacy",
		download: "Download",
		switchLocale: "中文",
		home: "PandaWork home",
	},
	hero: {
		badge: "Early preview · macOS first",
		title: { lead: "A calm companion that ", emphasis: "does the work", tail: "" },
		description:
			"PandaWork is a local-first AI coding agent that lives on your desktop. Describe what you need — it reads, edits and runs your project while you stay in control.",
		download: "Download for macOS",
		secondary: "See how it works",
		screenshotAlt: "PandaWork desktop app with a conversation-first workspace",
	},
	features: {
		eyebrow: "How it works",
		title: { lead: "Conversation is ", emphasis: "the workspace", tail: "" },
		description: "Not an IDE, not a chatbot. An agent that understands your project and gets things done.",
		items: [
			{
				title: "Talk, don't configure",
				description:
					"Start with a sentence. Streaming replies, visible reasoning, follow-ups and steering mid-task.",
			},
			{
				title: "Works right in your project",
				description: "Read, write, edit, find, grep and bash — scoped to the folder you choose.",
			},
			{
				title: "You approve what matters",
				description: "Permission rules and a risky-command scanner pause the agent until you say yes.",
			},
			{
				title: "Remembers the thread",
				description: "Sessions, todo progress, output files and context compaction survive every restart.",
			},
		],
		screenshotAlt: "PandaWork producing a research report with progress, outputs and artifacts panels",
	},
	models: {
		eyebrow: "Models",
		title: { lead: "Bring ", emphasis: "your own", tail: " model" },
		description: "Use the providers and keys you already have. Switch models per conversation.",
		items: [
			{ name: "Anthropic", description: "Claude models with extended thinking." },
			{ name: "OpenAI", description: "Responses API, reasoning included." },
			{ name: "OpenAI-compatible", description: "Any hosted endpoint that speaks the OpenAI API." },
			{ name: "Local models", description: "Ollama, LM Studio and other servers on your machine." },
		],
	},
	privacy: {
		eyebrow: "Local-first",
		title: { lead: "Your work ", emphasis: "stays yours", tail: "" },
		description: "PandaWork runs on your machine. There is no PandaWork cloud in the middle.",
		items: [
			{
				title: "Stored on your machine",
				description: "Sessions and history live in a local database under your home folder.",
			},
			{
				title: "Direct to your provider",
				description: "Requests go straight to the model you picked — or never leave your computer.",
			},
			{
				title: "Nothing runs unasked",
				description: "Writes and commands follow your permission mode, and you can stop the agent anytime.",
			},
		],
	},
	closing: {
		title: { lead: "Leave the busywork behind.", emphasis: "Keep the craft.", tail: "" },
		description:
			"Download PandaWork and give your next task to a companion that stays calm, capable and on your side.",
		download: "Download for macOS",
		comingSoon: "Coming soon",
		note: "Free during early preview. Windows and Linux builds are on the way.",
	},
	footer: {
		tagline: "A calm, local-first AI coding agent.",
		copyright: "PandaWork. Built with care.",
	},
} satisfies LandingCopy;
