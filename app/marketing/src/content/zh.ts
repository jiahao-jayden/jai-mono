import type { LandingCopy } from "./types";

export const zh = {
	meta: {
		title: "PandaWork — 安静、本地优先的桌面 AI coding agent",
		description:
			"PandaWork 是一个本地优先的桌面 AI coding agent。用对话描述需求，它在你的项目里读写文件、执行命令——经你批准，在你的电脑上，用你选择的模型。",
	},
	nav: {
		features: "功能",
		models: "模型",
		privacy: "隐私",
		docs: "文档",
		download: "下载",
		switchLocale: "EN",
		home: "PandaWork 首页",
		github: "在 GitHub 上查看 PandaWork",
	},
	hero: {
		badge: "早期预览 · 优先支持 macOS",
		title: { lead: "一位安静的伙伴，", emphasis: "替你把事做完", tail: "" },
		description:
			"PandaWork 是常驻桌面、本地优先的 AI coding agent。说出你要做的事，它会阅读、修改并运行你的项目，而决定权始终在你手里。",
		download: "下载 macOS 版",
		secondary: "看看它怎么工作",
		screenshotAlt: "以对话为中心的 PandaWork 桌面应用",
	},
	features: {
		eyebrow: "工作方式",
		title: { lead: "对话，", emphasis: "就是工作区", tail: "" },
		description: "不是 IDE，也不只是聊天机器人。它理解你的项目，并把事情真正做完。",
		items: [
			{
				title: "开口就能开始",
				description: "一句话起步。流式回复、可见的思考过程，任务中途也能追问和纠偏。",
			},
			{
				title: "直接在项目里工作",
				description: "read、write、edit、find、grep、bash——只在你选定的文件夹内生效。",
			},
			{
				title: "关键操作由你批准",
				description: "权限规则与危险命令扫描会让 agent 停下来，等你点头再继续。",
			},
			{
				title: "记得来龙去脉",
				description: "会话、Todo 进度、产出文件与上下文压缩，重启之后依然都在。",
			},
		],
		screenshotAlt: "PandaWork 设置页：界面语言、主题、辅助模型与最大迭代次数",
	},
	models: {
		eyebrow: "模型",
		title: { lead: "用", emphasis: "你自己的", tail: "模型" },
		description: "沿用你已有的 provider 和密钥，每个对话都可以单独切换模型。",
		items: [
			{ name: "Anthropic", description: "Claude 系列模型，支持扩展思考。" },
			{ name: "OpenAI", description: "Responses API，包含推理能力。" },
			{ name: "OpenAI 兼容服务", description: "任何兼容 OpenAI API 的托管端点。" },
			{ name: "本地模型", description: "Ollama、LM Studio 等运行在本机的服务。" },
		],
	},
	privacy: {
		eyebrow: "本地优先",
		title: { lead: "你的工作，", emphasis: "始终属于你", tail: "" },
		description: "PandaWork 运行在你的电脑上，中间没有 PandaWork 云端。",
		items: [
			{
				title: "数据存在本机",
				description: "会话与历史保存在你主目录下的本地数据库中。",
			},
			{
				title: "直连你的 provider",
				description: "请求直接发往你选择的模型，或者根本不离开你的电脑。",
			},
			{
				title: "不会擅自行动",
				description: "写入和命令遵循你设定的权限模式，随时可以让 agent 停下。",
			},
		],
	},
	closing: {
		title: { lead: "把琐碎交给它，", emphasis: "把创造留给自己。", tail: "" },
		description: "下载 PandaWork，把下一个任务交给一位安静、能干、站在你这边的伙伴。",
		download: "下载 macOS 版",
		comingSoon: "即将开放下载",
		note: "早期预览期间免费。Windows 与 Linux 版本即将推出。",
	},
	footer: {
		tagline: "安静、本地优先的 AI coding agent。",
		copyright: "PandaWork. 用心打造。",
	},
} satisfies LandingCopy;
