"use client";

import {
	Add01Icon,
	Alert02Icon,
	Archive01Icon,
	ArrowDown01Icon,
	ArrowLeft01Icon,
	ArrowRight01Icon,
	ArrowTurnForwardIcon,
	ArrowUp01Icon,
	ArrowUp02Icon,
	BrainIcon,
	BrowserIcon,
	BubbleChatIcon,
	Cancel01Icon,
	CircleIcon,
	Clock01Icon,
	ColorsIcon,
	ComputerIcon,
	ComputerTerminal01Icon,
	Copy01Icon,
	Delete02Icon,
	DropperIcon,
	Edit01Icon,
	EyeIcon,
	FavouriteIcon,
	FileCodeIcon,
	Folder01Icon,
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
	Notification01Icon,
	PaintBrush01Icon,
	PanelLeftCloseIcon,
	PanelRightIcon,
	PauseIcon,
	PlayIcon,
	RefreshIcon,
	Rocket01Icon,
	Search01Icon,
	Settings01Icon,
	Shield01Icon,
	SparklesIcon,
	SquareLock01Icon,
	StarIcon,
	StopCircleIcon,
	Sun01Icon,
	Tick01Icon,
	UserGroupIcon,
	UserIcon,
	ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { IconType } from "@lobehub/icons";
import Anthropic from "@lobehub/icons/es/Anthropic";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Kimi from "@lobehub/icons/es/Kimi";
import Minimax from "@lobehub/icons/es/Minimax";
import OpenAI from "@lobehub/icons/es/OpenAI";
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
	| "send"
	| "search"
	| "loader"
	| "users"
	| "lock"
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
	| "check"
	| "rotate-ccw"
	| "play"
	| "pause"
	| "pipette"
	| "home"
	| "message-circle"
	| "archive"
	| "folder"
	| "folder-off"
	| "folder-open"
	| "panel-left-close"
	| "panel-right"
	| "sparkles"
	| "terminal"
	| "key"
	| "trash"
	| "file-code"
	| "layers"
	| "stop-circle"
	| "shield-alert"
	| "inbox"
	| "pencil"
	| "eye"
	| "eye-off"
	| "skip-forward"
	| "corner-down-right";

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
	send: createHugeicon(ArrowUp02Icon),
	search: createHugeicon(Search01Icon),
	loader: createHugeicon(Loading03Icon),
	users: createHugeicon(UserGroupIcon),
	lock: createHugeicon(SquareLock01Icon),
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
	check: createHugeicon(Tick01Icon),
	"rotate-ccw": createHugeicon(RefreshIcon),
	play: createHugeicon(PlayIcon),
	pause: createHugeicon(PauseIcon),
	home: createHugeicon(Home01Icon),
	"message-circle": createHugeicon(BubbleChatIcon),
	archive: createHugeicon(Archive01Icon),
	folder: createHugeicon(Folder01Icon),
	"folder-off": createHugeicon(FolderOffIcon),
	"folder-open": createHugeicon(FolderOpenIcon),
	"panel-left-close": createHugeicon(PanelLeftCloseIcon),
	"panel-right": createHugeicon(PanelRightIcon),
	sparkles: createHugeicon(SparklesIcon),
	terminal: createHugeicon(ComputerTerminal01Icon),
	key: createHugeicon(Key01Icon),
	trash: createHugeicon(Delete02Icon),
	"file-code": createHugeicon(FileCodeIcon),
	layers: createHugeicon(Layers01Icon),
	"stop-circle": createHugeicon(StopCircleIcon),
	"shield-alert": createHugeicon(Alert02Icon),
	inbox: createHugeicon(InboxIcon),
	pencil: createHugeicon(Edit01Icon),
	eye: createHugeicon(EyeIcon),
	"eye-off": createHugeicon(ViewOffSlashIcon),
	"skip-forward": createHugeicon(Forward01Icon),
	"corner-down-right": createHugeicon(ArrowTurnForwardIcon),
};

const providerBrandIcons: Readonly<Record<string, IconComponent>> = {
	anthropic: createBrandIcon(Anthropic),
	deepseek: createBrandIcon(DeepSeek),
	minimax: createBrandIcon(Minimax),
	moonshot: createBrandIcon(Kimi),
	moonshotai: createBrandIcon(Kimi),
	openai: createBrandIcon(OpenAI),
};

function resolveProviderBrandIcon(providerId?: string, modelId?: string): IconComponent {
	const normalizedProviderId = providerId?.toLocaleLowerCase() ?? "";
	const explicit = providerBrandIcons[normalizedProviderId];
	if (explicit) return explicit;

	const normalizedModelId = modelId?.toLocaleLowerCase() ?? "";
	if (normalizedModelId.startsWith("claude-")) return providerBrandIcons.anthropic;
	if (/^(gpt-|chatgpt-|o[1-9]|codex-)/.test(normalizedModelId)) return providerBrandIcons.openai;
	if (normalizedModelId.startsWith("deepseek-")) return providerBrandIcons.deepseek;
	if (normalizedModelId.startsWith("minimax-")) return providerBrandIcons.minimax;
	if (normalizedModelId.startsWith("kimi-") || normalizedModelId.startsWith("moonshot-")) {
		return providerBrandIcons.moonshotai;
	}
	return defaultIcons.sparkles;
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

export { IconProvider, resolveProviderBrandIcon, useIcon, useIcons };
