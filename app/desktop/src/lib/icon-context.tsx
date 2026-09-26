import {
	Add01Icon,
	AiSecurity02Icon,
	Alert02Icon,
	Analytics01Icon,
	ApiIcon,
	Archive02Icon,
	ArrowDown01Icon,
	ArrowLeft01Icon,
	ArrowRight01Icon,
	ArrowTurnForwardIcon,
	ArrowUp01Icon,
	ArrowUp02Icon,
	ArrowUpRight03Icon,
	BrainIcon,
	BrowserIcon,
	BubbleChatIcon,
	Cancel01Icon,
	CheckListIcon,
	CircleIcon,
	Clock01Icon,
	ColorsIcon,
	CommandLineIcon,
	ComputerIcon,
	ComputerTerminal01Icon,
	Copy01Icon,
	Delete02Icon,
	DropperIcon,
	Edit01Icon,
	EyeIcon,
	FavouriteIcon,
	FileCodeIcon,
	FileEditIcon,
	FileSearchIcon,
	Folder01Icon,
	Folder02Icon,
	FolderOffIcon,
	FolderOpenIcon,
	Forward01Icon,
	Globe02Icon,
	Home01Icon,
	Idea01Icon,
	Image01Icon,
	InboxIcon,
	Key01Icon,
	Layers01Icon,
	LibrariesIcon,
	Link01Icon,
	Loading03Icon,
	Mail01Icon,
	Menu01Icon,
	Moon02Icon,
	MoreHorizontalIcon,
	MoreVerticalIcon,
	Notification01Icon,
	PaintBrush01Icon,
	PanelLeftCloseIcon,
	PanelRightIcon,
	PauseIcon,
	PencilEdit02Icon,
	PinIcon,
	PlayIcon,
	Plug01Icon,
	RefreshIcon,
	Rocket01Icon,
	Search01Icon,
	SearchCodeIcon,
	Settings01Icon,
	Shield01Icon,
	SparklesIcon,
	SquareLock01Icon,
	SquareUnlock02Icon,
	StarIcon,
	StopCircleIcon,
	StopIcon,
	Sun01Icon,
	Tick01Icon,
	UserGroupIcon,
	UserIcon,
	ViewOffSlashIcon,
	WorkflowCircle01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { IconType } from "@lobehub/icons";
import Alibaba from "@lobehub/icons/es/Alibaba";
import Anthropic from "@lobehub/icons/es/Anthropic";
import ChatGLM from "@lobehub/icons/es/ChatGLM";
import Cloudflare from "@lobehub/icons/es/Cloudflare";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Doubao from "@lobehub/icons/es/Doubao";
import Gemini from "@lobehub/icons/es/Gemini";
import Google from "@lobehub/icons/es/Google";
import Grok from "@lobehub/icons/es/Grok";
import Groq from "@lobehub/icons/es/Groq";
import Hunyuan from "@lobehub/icons/es/Hunyuan";
import Kimi from "@lobehub/icons/es/Kimi";
import Minimax from "@lobehub/icons/es/Minimax";
import Mistral from "@lobehub/icons/es/Mistral";
import OpenAI from "@lobehub/icons/es/OpenAI";
import Qwen from "@lobehub/icons/es/Qwen";
import SiliconCloud from "@lobehub/icons/es/SiliconCloud";
import Tencent from "@lobehub/icons/es/Tencent";
import Vercel from "@lobehub/icons/es/Vercel";
import Volcengine from "@lobehub/icons/es/Volcengine";
import XAI from "@lobehub/icons/es/XAI";
import Zhipu from "@lobehub/icons/es/Zhipu";
import { BanIcon, CircleCheckIcon, HandIcon } from "lucide-react";
import { type ComponentType, createContext, type ReactNode, useContext, useMemo } from "react";

export interface IconComponentProps {
	size?: number;
	strokeWidth?: number;
	className?: string;
}

export type IconComponent = ComponentType<IconComponentProps>;

export type IconName =
	| "chevron-right"
	| "chevron-down"
	| "x"
	| "copy"
	| "menu"
	| "dot"
	| "more-vertical"
	| "monitor"
	| "sun"
	| "moon"
	| "rectangle-horizontal"
	| "circle"
	| "square-library"
	| "clock"
	| "star"
	| "settings"
	| "plus"
	| "arrow-left"
	| "arrow-right"
	| "arrow-up"
	| "arrow-up-right"
	| "send"
	| "search"
	| "search-code"
	| "loader"
	| "users"
	| "lock"
	| "unlock"
	| "mail"
	| "bell"
	| "shield"
	| "palette"
	| "lightbulb"
	| "rocket"
	| "heart"
	| "paintbrush"
	| "brain"
	| "globe"
	| "user"
	| "image"
	| "link"
	| "api"
	| "check"
	| "check-list"
	| "rotate-ccw"
	| "play"
	| "pause"
	| "pipette"
	| "home"
	| "message-circle"
	| "archive"
	| "pin"
	| "folder"
	| "folder-off"
	| "folder-open"
	| "panel-left-close"
	| "panel-right"
	| "sparkles"
	| "ai-security"
	| "terminal"
	| "command"
	| "workflow"
	| "key"
	| "trash"
	| "file-code"
	| "file-search"
	| "file-edit"
	| "layers"
	| "stop"
	| "stop-circle"
	| "shield-alert"
	| "permission-allow"
	| "permission-ask"
	| "permission-deny"
	| "inbox"
	| "pencil"
	| "eye"
	| "eye-off"
	| "skip-forward"
	| "corner-down-right"
	| "plug"
	| "analytics";

function createHugeicon(icon: IconSvgElement): IconComponent {
	return function Hugeicon(props) {
		return <HugeiconsIcon icon={icon} {...props} />;
	};
}

function createBrandIcon(Brand: IconType): IconComponent {
	return function BrandIcon({ size = 16, className }: IconComponentProps) {
		return <Brand aria-hidden="true" className={className} size={size} />;
	};
}

export const defaultIcons: Record<IconName, IconComponent> = {
	"chevron-right": createHugeicon(ArrowRight01Icon),
	"chevron-down": createHugeicon(ArrowDown01Icon),
	pipette: createHugeicon(DropperIcon),
	x: createHugeicon(Cancel01Icon),
	copy: createHugeicon(Copy01Icon),
	menu: createHugeicon(Menu01Icon),
	dot: createHugeicon(MoreHorizontalIcon),
	"more-vertical": createHugeicon(MoreVerticalIcon),
	monitor: createHugeicon(ComputerIcon),
	sun: createHugeicon(Sun01Icon),
	moon: createHugeicon(Moon02Icon),
	"rectangle-horizontal": createHugeicon(BrowserIcon),
	circle: createHugeicon(CircleIcon),
	"square-library": createHugeicon(LibrariesIcon),
	clock: createHugeicon(Clock01Icon),
	star: createHugeicon(StarIcon),
	settings: createHugeicon(Settings01Icon),
	plus: createHugeicon(Add01Icon),
	"arrow-left": createHugeicon(ArrowLeft01Icon),
	"arrow-right": createHugeicon(ArrowRight01Icon),
	"arrow-up": createHugeicon(ArrowUp01Icon),
	"arrow-up-right": createHugeicon(ArrowUpRight03Icon),
	send: createHugeicon(ArrowUp02Icon),
	search: createHugeicon(Search01Icon),
	"search-code": createHugeicon(SearchCodeIcon),
	loader: createHugeicon(Loading03Icon),
	users: createHugeicon(UserGroupIcon),
	lock: createHugeicon(SquareLock01Icon),
	unlock: createHugeicon(SquareUnlock02Icon),
	mail: createHugeicon(Mail01Icon),
	bell: createHugeicon(Notification01Icon),
	shield: createHugeicon(Shield01Icon),
	palette: createHugeicon(ColorsIcon),
	lightbulb: createHugeicon(Idea01Icon),
	rocket: createHugeicon(Rocket01Icon),
	heart: createHugeicon(FavouriteIcon),
	paintbrush: createHugeicon(PaintBrush01Icon),
	brain: createHugeicon(BrainIcon),
	globe: createHugeicon(Globe02Icon),
	user: createHugeicon(UserIcon),
	image: createHugeicon(Image01Icon),
	link: createHugeicon(Link01Icon),
	api: createHugeicon(ApiIcon),
	check: createHugeicon(Tick01Icon),
	"check-list": createHugeicon(CheckListIcon),
	"rotate-ccw": createHugeicon(RefreshIcon),
	play: createHugeicon(PlayIcon),
	pause: createHugeicon(PauseIcon),
	home: createHugeicon(Home01Icon),
	"message-circle": createHugeicon(BubbleChatIcon),
	archive: createHugeicon(Archive02Icon),
	pin: createHugeicon(PinIcon),
	folder: createHugeicon(Folder01Icon),
	"folder-off": createHugeicon(FolderOffIcon),
	"folder-open": createHugeicon(Folder02Icon),
	"panel-left-close": createHugeicon(PanelLeftCloseIcon),
	"panel-right": createHugeicon(PanelRightIcon),
	sparkles: createHugeicon(SparklesIcon),
	"ai-security": createHugeicon(AiSecurity02Icon),
	terminal: createHugeicon(ComputerTerminal01Icon),
	command: createHugeicon(CommandLineIcon),
	workflow: createHugeicon(WorkflowCircle01Icon),
	key: createHugeicon(Key01Icon),
	trash: createHugeicon(Delete02Icon),
	"file-code": createHugeicon(FileCodeIcon),
	"file-search": createHugeicon(FileSearchIcon),
	"file-edit": createHugeicon(FileEditIcon),
	layers: createHugeicon(Layers01Icon),
	stop: createHugeicon(StopIcon),
	"stop-circle": createHugeicon(StopCircleIcon),
	"shield-alert": createHugeicon(Alert02Icon),
	"permission-allow": CircleCheckIcon,
	"permission-ask": HandIcon,
	"permission-deny": BanIcon,
	inbox: createHugeicon(InboxIcon),
	pencil: createHugeicon(PencilEdit02Icon),
	eye: createHugeicon(EyeIcon),
	"eye-off": createHugeicon(ViewOffSlashIcon),
	"skip-forward": createHugeicon(Forward01Icon),
	"corner-down-right": createHugeicon(ArrowTurnForwardIcon),
	plug: createHugeicon(Plug01Icon),
	analytics: createHugeicon(Analytics01Icon),
};

const anthropicIcon = createBrandIcon(Anthropic);
const openaiIcon = createBrandIcon(OpenAI);
const deepseekIcon = createBrandIcon(DeepSeek);
const minimaxIcon = createBrandIcon(Minimax);
const kimiIcon = createBrandIcon(Kimi);
const volcengineIcon = createBrandIcon(Volcengine);
const googleIcon = createBrandIcon(Google);
const alibabaIcon = createBrandIcon(Alibaba);
const zhipuIcon = createBrandIcon(Zhipu);
const tencentIcon = createBrandIcon(Tencent);
const siliconCloudIcon = createBrandIcon(SiliconCloud);
const xaiIcon = createBrandIcon(XAI);
const mistralIcon = createBrandIcon(Mistral);
const groqIcon = createBrandIcon(Groq);
const vercelIcon = createBrandIcon(Vercel);
const cloudflareIcon = createBrandIcon(Cloudflare);
const doubaoIcon = createBrandIcon(Doubao);
const qwenIcon = createBrandIcon(Qwen);
const chatGlmIcon = createBrandIcon(ChatGLM);
const geminiIcon = createBrandIcon(Gemini);
const grokIcon = createBrandIcon(Grok);
const hunyuanIcon = createBrandIcon(Hunyuan);

const providerBrandIcons: Readonly<Record<string, IconComponent>> = {
	anthropic: anthropicIcon,
	openai: openaiIcon,
	deepseek: deepseekIcon,
	minimax: minimaxIcon,
	"minimax-cn": minimaxIcon,
	moonshot: kimiIcon,
	moonshotai: kimiIcon,
	"moonshotai-cn": kimiIcon,
	volcengine: volcengineIcon,
	google: googleIcon,
	alibaba: alibabaIcon,
	"alibaba-cn": alibabaIcon,
	zhipuai: zhipuIcon,
	"tencent-tokenhub": tencentIcon,
	siliconflow: siliconCloudIcon,
	"siliconflow-cn": siliconCloudIcon,
	xai: xaiIcon,
	mistral: mistralIcon,
	groq: groqIcon,
	vercel: vercelIcon,
	"vercel-ai-gateway": vercelIcon,
	"cloudflare-workers-ai": cloudflareIcon,
};

const modelBrandPrefixes: readonly { readonly prefix: string | RegExp; readonly icon: IconComponent }[] = [
	{ prefix: "claude-", icon: anthropicIcon },
	{ prefix: /^(gpt-|chatgpt-|o[1-9]|codex-)/, icon: openaiIcon },
	{ prefix: "deepseek-", icon: deepseekIcon },
	{ prefix: "minimax-", icon: minimaxIcon },
	{ prefix: "kimi-", icon: kimiIcon },
	{ prefix: "moonshot-", icon: kimiIcon },
	{ prefix: "doubao-", icon: doubaoIcon },
	{ prefix: "qwen", icon: qwenIcon },
	{ prefix: "glm-", icon: chatGlmIcon },
	{ prefix: "chatglm-", icon: chatGlmIcon },
	{ prefix: "gemini-", icon: geminiIcon },
	{ prefix: "grok-", icon: grokIcon },
	{ prefix: "mistral-", icon: mistralIcon },
	{ prefix: "codestral-", icon: mistralIcon },
	{ prefix: "pixtral-", icon: mistralIcon },
	{ prefix: "ministral-", icon: mistralIcon },
	{ prefix: "hunyuan-", icon: hunyuanIcon },
];

function resolveProviderBrandIcon(providerId?: string): IconComponent {
	return providerBrandIcons[providerId?.toLocaleLowerCase() ?? ""] ?? defaultIcons.sparkles;
}

function resolveModelBrandIcon(modelId?: string): IconComponent {
	const slash = modelId?.lastIndexOf("/") ?? -1;
	const family = (slash >= 0 ? modelId?.slice(slash + 1) : modelId)?.trim().toLocaleLowerCase() ?? "";
	const matched = modelBrandPrefixes.find(({ prefix }) =>
		typeof prefix === "string" ? family.startsWith(prefix) : prefix.test(family),
	);
	return matched?.icon ?? defaultIcons.sparkles;
}

const IconContext = createContext<Record<IconName, IconComponent> | null>(null);

/**
 * Returns a single icon component for the given name.
 * Falls back to the default (Hugeicons) set if no provider is present.
 */
function useIcon(name: IconName): IconComponent {
	const icons = useContext(IconContext);
	return (icons ?? defaultIcons)[name];
}

/**
 * Returns the full icon map.
 * Falls back to the default (Hugeicons) set if no provider is present.
 */
function useIcons(): Record<IconName, IconComponent> {
	const icons = useContext(IconContext);
	return icons ?? defaultIcons;
}

/**
 * Swap some or all icons for components from another library.
 * Names left out of `icons` keep their default (Hugeicons) component.
 */
function IconProvider({ children, icons }: { children: ReactNode; icons?: Partial<Record<IconName, IconComponent>> }) {
	const value = useMemo(() => ({ ...defaultIcons, ...icons }), [icons]);
	return <IconContext.Provider value={value}>{children}</IconContext.Provider>;
}

export { IconProvider, resolveModelBrandIcon, resolveProviderBrandIcon, useIcon, useIcons };
