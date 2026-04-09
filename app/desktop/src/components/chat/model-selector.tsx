import {
	AiBrain01Icon,
	AiGenerativeIcon,
	ArrowDown01Icon,
	EyeIcon,
	GridIcon,
	HeadphonesIcon,
	Image01Icon,
	Pdf01Icon,
	Search01Icon,
	StructureCheckIcon,
	Tick02Icon,
	Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Anthropic from "@lobehub/icons/es/Anthropic";
import Baichuan from "@lobehub/icons/es/Baichuan";
import ChatGLM from "@lobehub/icons/es/ChatGLM";
import Claude from "@lobehub/icons/es/Claude";
import Cohere from "@lobehub/icons/es/Cohere";
import Dalle from "@lobehub/icons/es/Dalle";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Doubao from "@lobehub/icons/es/Doubao";
import Flux from "@lobehub/icons/es/Flux";
import Gemini from "@lobehub/icons/es/Gemini";
import Gemma from "@lobehub/icons/es/Gemma";
import Google from "@lobehub/icons/es/Google";
import Grok from "@lobehub/icons/es/Grok";
import Hunyuan from "@lobehub/icons/es/Hunyuan";
import InternLM from "@lobehub/icons/es/InternLM";
import Kimi from "@lobehub/icons/es/Kimi";
import Meta from "@lobehub/icons/es/Meta";
import Microsoft from "@lobehub/icons/es/Microsoft";
import Minimax from "@lobehub/icons/es/Minimax";
import Mistral from "@lobehub/icons/es/Mistral";
import Moonshot from "@lobehub/icons/es/Moonshot";
import Nvidia from "@lobehub/icons/es/Nvidia";
import OpenAI from "@lobehub/icons/es/OpenAI";
import Qwen from "@lobehub/icons/es/Qwen";
import Spark from "@lobehub/icons/es/Spark";
import Stepfun from "@lobehub/icons/es/Stepfun";
import Wenxin from "@lobehub/icons/es/Wenxin";
import Yi from "@lobehub/icons/es/Yi";
import { type ComponentType, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ModelCapabilities, ModelItem } from "@/stores/chat";

// ── Brand Icon Resolution ───────────────────────────────────
//
// Match from model ID (the actual model name), not the user-defined provider alias.
// Order matters: more specific patterns must come before broader ones.
// e.g. "dall-e" before "gpt" (both are OpenAI, but dall-e has its own icon).

type IconComponent = ComponentType<{ className?: string; size?: number }>;

const MODEL_BRAND_RULES: [patterns: string[], icon: IconComponent, brand: string][] = [
	// OpenAI model families
	[["dall-e", "dalle"], Dalle, "DALL-E"],
	[["gpt-", "gpt4", "gpt3", "gpt5", "chatgpt", "o1-", "o3-", "o4-", "o1pro"], OpenAI, "OpenAI"],
	// Anthropic
	[["claude"], Claude, "Claude"],
	// Google
	[["gemma"], Gemma, "Gemma"],
	[["gemini", "palm"], Gemini, "Gemini"],
	// Meta
	[["llama", "llava"], Meta, "Meta"],
	// DeepSeek
	[["deepseek"], DeepSeek, "DeepSeek"],
	// Mistral
	[["mistral", "mixtral", "codestral", "pixtral", "ministral"], Mistral, "Mistral"],
	// Qwen (Alibaba)
	[["qwen", "qwq"], Qwen, "Qwen"],
	// ByteDance / Doubao
	[["doubao", "skylark"], Doubao, "Doubao"],
	// Baichuan
	[["baichuan"], Baichuan, "Baichuan"],
	// Zhipu / ChatGLM
	[["glm", "chatglm"], ChatGLM, "ChatGLM"],
	// MiniMax
	[["minimax", "abab"], Minimax, "MiniMax"],
	// Moonshot / Kimi
	[["kimi"], Kimi, "Kimi"],
	[["moonshot"], Moonshot, "Moonshot"],
	// Baidu / ERNIE
	[["ernie", "wenxin"], Wenxin, "Wenxin"],
	// iFlyTek Spark
	[["spark"], Spark, "Spark"],
	// XAI / Grok
	[["grok"], Grok, "Grok"],
	// InternLM (Shanghai AI Lab)
	[["internlm"], InternLM, "InternLM"],
	// StepFun
	[["step-"], Stepfun, "StepFun"],
	// Tencent Hunyuan
	[["hunyuan"], Hunyuan, "Hunyuan"],
	// 01.AI / Yi
	[["yi-"], Yi, "Yi"],
	// Cohere
	[["command-r", "command-a", "c4ai"], Cohere, "Cohere"],
	// Microsoft Phi
	[["phi-", "phi3", "phi4"], Microsoft, "Microsoft"],
	// Nvidia
	[["nemotron"], Nvidia, "Nvidia"],
	// Flux (image gen)
	[["flux"], Flux, "Flux"],
];

// Provider-name → icon fallback (when no model ID matches)
const PROVIDER_BRAND_RULES: [patterns: string[], icon: IconComponent, brand: string][] = [
	[["openai"], OpenAI, "OpenAI"],
	[["anthropic"], Anthropic, "Anthropic"],
	[["claude"], Claude, "Claude"],
	[["google"], Google, "Google"],
	[["gemini"], Gemini, "Gemini"],
	[["meta"], Meta, "Meta"],
	[["deepseek"], DeepSeek, "DeepSeek"],
	[["mistral"], Mistral, "Mistral"],
	[["qwen", "alibaba", "dashscope"], Qwen, "Qwen"],
	[["doubao", "bytedance", "volcengine"], Doubao, "Doubao"],
	[["baichuan"], Baichuan, "Baichuan"],
	[["zhipu", "chatglm"], ChatGLM, "ChatGLM"],
	[["minimax"], Minimax, "MiniMax"],
	[["moonshot"], Moonshot, "Moonshot"],
	[["kimi"], Kimi, "Kimi"],
	[["baidu", "wenxin", "ernie"], Wenxin, "Wenxin"],
	[["iflytek", "spark"], Spark, "Spark"],
	[["xai", "grok"], Grok, "Grok"],
	[["stepfun", "step"], Stepfun, "StepFun"],
	[["hunyuan", "tencent"], Hunyuan, "Hunyuan"],
	[["yi", "lingyiwanwu", "01ai"], Yi, "Yi"],
	[["cohere"], Cohere, "Cohere"],
	[["microsoft", "azure"], Microsoft, "Microsoft"],
	[["nvidia"], Nvidia, "Nvidia"],
];

function matchBrand(
	input: string,
	rules: [patterns: string[], icon: IconComponent, brand: string][],
): { icon: IconComponent; brand: string } | null {
	const lower = input.toLowerCase();
	for (const [patterns, icon, brand] of rules) {
		if (patterns.some((p) => lower.includes(p))) return { icon, brand };
	}
	return null;
}

function resolveModelIcon(modelId: string): { icon: IconComponent; brand: string } | null {
	const modelName = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
	return matchBrand(modelName, MODEL_BRAND_RULES);
}

function resolveProviderIcon(providerId: string): { icon: IconComponent; brand: string } | null {
	return matchBrand(providerId, PROVIDER_BRAND_RULES);
}

// ── Icon Avatar Components ──────────────────────────────────

function BrandAvatar({ icon: Icon, size = 20 }: { icon: IconComponent | null; size?: number }) {
	if (Icon) return <Icon className="shrink-0" size={size} />;
	return (
		<HugeiconsIcon
			icon={AiGenerativeIcon}
			size={size}
			strokeWidth={1.5}
			className="shrink-0 text-muted-foreground/50"
		/>
	);
}

function ModelAvatar({ model, size = 20 }: { model: ModelItem; size?: number }) {
	const match = resolveModelIcon(model.id);
	return <BrandAvatar icon={match?.icon ?? null} size={size} />;
}

// ── Capability Badges ───────────────────────────────────────

const CAPABILITY_DEFS: {
	key: keyof ModelCapabilities;
	icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
	label: string;
	color: string;
}[] = [
	{ key: "reasoning", icon: AiBrain01Icon, label: "Reasoning", color: "text-amber-600" },
	{ key: "toolCall", icon: Wrench01Icon, label: "Tool Use", color: "text-sky-600" },
	{ key: "vision", icon: EyeIcon, label: "Vision", color: "text-emerald-600" },
	{ key: "structuredOutput", icon: StructureCheckIcon, label: "Structured", color: "text-violet-600" },
	{ key: "imageGen", icon: Image01Icon, label: "Image Gen", color: "text-rose-600" },
	{ key: "audio", icon: HeadphonesIcon, label: "Audio", color: "text-cyan-600" },
	{ key: "pdf", icon: Pdf01Icon, label: "PDF", color: "text-orange-600" },
];

function CapabilityBadges({ capabilities }: { capabilities?: ModelCapabilities }) {
	if (!capabilities) return null;
	const active = CAPABILITY_DEFS.filter((d) => capabilities[d.key]);
	if (active.length === 0) return null;

	return (
		<TooltipProvider>
			<div className="flex items-center gap-1">
				{active.map((d) => (
					<Tooltip key={d.key}>
						<TooltipTrigger asChild>
							<span className={cn("inline-flex items-center justify-center rounded-md p-0.5", d.color)}>
								<HugeiconsIcon icon={d.icon} size={14} strokeWidth={2} />
							</span>
						</TooltipTrigger>
						<TooltipContent side="top">{d.label}</TooltipContent>
					</Tooltip>
				))}
			</div>
		</TooltipProvider>
	);
}

// ── Main Component ──────────────────────────────────────────

interface ModelSelectorProps {
	models: ModelItem[];
	currentModelId: string | null;
	onSelect: (modelId: string) => void;
}

const ALL_PROVIDERS = "__all__";

export function ModelSelector({ models, currentModelId, onSelect }: ModelSelectorProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [activeProvider, setActiveProvider] = useState(ALL_PROVIDERS);

	const current = models.find((m) => m.id === currentModelId);
	const triggerLabel = current?.displayName ?? currentModelId?.split("/").pop() ?? "Select model";

	const providers = useMemo(() => {
		const seen = new Map<string, number>();
		for (const m of models) {
			seen.set(m.provider, (seen.get(m.provider) ?? 0) + 1);
		}
		return Array.from(seen.entries()).map(([id, count]) => {
			const resolved = resolveProviderIcon(id);
			return { id, count, icon: resolved?.icon ?? null, brand: resolved?.brand ?? id };
		});
	}, [models]);

	const filtered = useMemo(() => {
		let list = models;
		if (activeProvider !== ALL_PROVIDERS) {
			list = list.filter((m) => m.provider === activeProvider);
		}
		if (search.trim()) {
			const q = search.toLowerCase();
			list = list.filter((m) => m.displayName.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
		}
		return list;
	}, [models, activeProvider, search]);

	if (models.length === 0) {
		return <span className="text-xs text-muted-foreground px-2 py-1 select-none">{triggerLabel}</span>;
	}

	const handleSelect = (modelId: string) => {
		onSelect(modelId);
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-accent transition-colors"
				>
					{current && <ModelAvatar model={current} size={12} />}
					<span className="max-w-28 truncate">{triggerLabel}</span>
					<HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} className="shrink-0 opacity-50" />
				</button>
			</PopoverTrigger>

			<PopoverContent align="start" side="top" sideOffset={8} className="w-80 p-0 overflow-hidden">
				{/* Search Bar */}
				<div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-border/40">
					<HugeiconsIcon
						icon={Search01Icon}
						size={14}
						strokeWidth={2}
						className="shrink-0 text-muted-foreground"
					/>
					<input
						type="text"
						placeholder="Search models..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
						// biome-ignore lint/a11y/noAutofocus: intentional focus on popover open
						autoFocus
					/>
				</div>

				{/* Two-panel body */}
				<div className="flex" style={{ height: 260 }}>
					{/* Provider sidebar */}
					<div className="w-10 shrink-0 border-r border-border/40 py-1">
						<ScrollArea className="h-full">
							<div className="flex flex-col items-center gap-0.5 px-0.5">
								<TooltipProvider>
									<Tooltip>
										<TooltipTrigger asChild>
											<button
												type="button"
												onClick={() => setActiveProvider(ALL_PROVIDERS)}
												className={cn(
													"flex items-center justify-center size-7 rounded-md transition-colors",
													activeProvider === ALL_PROVIDERS
														? "bg-accent text-foreground"
														: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
												)}
											>
												<HugeiconsIcon icon={GridIcon} size={14} strokeWidth={1.5} />
											</button>
										</TooltipTrigger>
										<TooltipContent side="right">All Providers</TooltipContent>
									</Tooltip>
								</TooltipProvider>

								<div className="w-4 h-px bg-border/40 my-0.5" />

								{providers.map((p) => (
									<TooltipProvider key={p.id}>
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													onClick={() => setActiveProvider(activeProvider === p.id ? ALL_PROVIDERS : p.id)}
													className={cn(
														"flex items-center justify-center size-7 rounded-md transition-colors",
														activeProvider === p.id
															? "bg-accent text-foreground"
															: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
													)}
												>
													<BrandAvatar icon={p.icon} size={15} />
												</button>
											</TooltipTrigger>
											<TooltipContent side="right">
												{p.brand}
												<span className="ml-1 text-muted-foreground">({p.count})</span>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								))}
							</div>
						</ScrollArea>
					</div>

					{/* Model list */}
					<ScrollArea className="flex-1">
						<div className="py-0.5 px-0.5">
							{filtered.length === 0 && (
								<div className="flex items-center justify-center h-24 text-xs text-muted-foreground">
									No models found
								</div>
							)}

							{filtered.map((m) => {
								const isSelected = m.id === currentModelId;
								return (
									<button
										key={m.id}
										type="button"
										onClick={() => handleSelect(m.id)}
										className={cn(
											"w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors",
											isSelected ? "bg-accent/80" : "hover:bg-accent/50",
										)}
									>
										<ModelAvatar model={m} size={16} />
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-1.5">
												<span
													className={cn(
														"text-xs truncate",
														isSelected
															? "font-semibold text-foreground"
															: "font-medium text-foreground/90",
													)}
												>
													{m.displayName}
												</span>
												<CapabilityBadges capabilities={m.capabilities} />
											</div>
											<span className="text-[10px] text-muted-foreground/60 truncate block leading-tight">
												{m.provider}
											</span>
										</div>
										{isSelected && (
											<HugeiconsIcon
												icon={Tick02Icon}
												size={14}
												strokeWidth={2}
												className="shrink-0 text-foreground"
											/>
										)}
									</button>
								);
							})}
						</div>
					</ScrollArea>
				</div>
			</PopoverContent>
		</Popover>
	);
}
