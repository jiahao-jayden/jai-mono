"use client";

import {
	Add01Icon,
	ArrowDown01Icon,
	ArrowLeft01Icon,
	ArrowRight01Icon,
	ArrowTurnForwardIcon,
	ArrowUp01Icon,
	BrainIcon,
	BrowserIcon,
	BubbleChatIcon,
	Cancel01Icon,
	CircleIcon,
	Clock01Icon,
	ColorsIcon,
	ComputerIcon,
	Copy01Icon,
	DropperIcon,
	Edit01Icon,
	FavouriteIcon,
	Forward01Icon,
	Globe02Icon,
	Home01Icon,
	Idea01Icon,
	Image01Icon,
	InboxIcon,
	LibrariesIcon,
	Link01Icon,
	Loading03Icon,
	Mail01Icon,
	Menu01Icon,
	Moon02Icon,
	MoreHorizontalIcon,
	Notification01Icon,
	PaintBrush01Icon,
	PauseIcon,
	PlayIcon,
	RefreshIcon,
	Rocket01Icon,
	Search01Icon,
	Settings01Icon,
	Shield01Icon,
	SquareLock01Icon,
	StarIcon,
	Sun01Icon,
	Tick01Icon,
	UserGroupIcon,
	UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
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
	| "inbox"
	| "pencil"
	| "skip-forward"
	| "corner-down-right";

function createHugeicon(icon: IconSvgElement): IconComponent {
	return function Hugeicon(props) {
		return <HugeiconsIcon icon={icon} {...props} />;
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
	inbox: createHugeicon(InboxIcon),
	pencil: createHugeicon(Edit01Icon),
	"skip-forward": createHugeicon(Forward01Icon),
	"corner-down-right": createHugeicon(ArrowTurnForwardIcon),
};

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

export { IconProvider, useIcon, useIcons };
