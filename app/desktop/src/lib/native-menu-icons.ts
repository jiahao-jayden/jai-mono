import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { desktop } from "@/lib/desktop";
import { defaultIcons, type IconName } from "@/lib/icon-context";
import type { DesktopContextMenuItem } from "../../shared/desktop-rpc";

export type NativeMenuDescriptor = {
	readonly id: string;
	readonly label: string;
	readonly separatorBefore?: boolean;
	readonly destructive?: boolean;
	readonly icon?: IconName;
};

const NATIVE_MENU_ICON_POINTS = 16;
const NATIVE_MENU_ICON_SCALE = 2;
const iconDataUrlCache = new Map<IconName, Promise<string | null>>();

function toDesktopItem(item: NativeMenuDescriptor): DesktopContextMenuItem {
	return {
		id: item.id,
		label: item.label,
		...(item.separatorBefore === true ? { separatorBefore: true } : {}),
		...(item.destructive === true ? { destructive: true } : {}),
	};
}

async function rasterizeMenuIcon(name: IconName): Promise<string | null> {
	const cached = iconDataUrlCache.get(name);
	if (cached) return cached;
	const pending = rasterize(name)
		.catch(() => null)
		.then((dataUrl) => {
			if (!dataUrl) iconDataUrlCache.delete(name);
			return dataUrl;
		});
	iconDataUrlCache.set(name, pending);
	return pending;
}

async function rasterize(name: IconName): Promise<string | null> {
	const markup = renderToStaticMarkup(createElement(defaultIcons[name], { size: 24 }));
	if (!markup.includes("<svg")) return null;
	const svg = markup.replaceAll("currentColor", "#000");
	const image = new Image();
	image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	await image.decode();
	const size = NATIVE_MENU_ICON_POINTS * NATIVE_MENU_ICON_SCALE;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.drawImage(image, 0, 0, size, size);
	return canvas.toDataURL("image/png");
}

export async function withNativeMenuIcons(items: readonly NativeMenuDescriptor[]): Promise<DesktopContextMenuItem[]> {
	return Promise.all(
		items.map(async (item) => {
			const next = toDesktopItem(item);
			if (!item.icon) return next;
			const iconDataUrl = await rasterizeMenuIcon(item.icon);
			return iconDataUrl ? { ...next, iconDataUrl } : next;
		}),
	);
}

export async function showNativeMenu(
	items: readonly NativeMenuDescriptor[],
	position: { x: number; y: number },
): Promise<string | null> {
	return desktop.contextMenu.show({
		items: await withNativeMenuIcons(items),
		position,
	});
}

/** Keep the pointer above the first row so mouse-up does not fire Rename. */
const CONTEXT_MENU_POINTER_CLEARANCE = 16;

export function nativeMenuAnchor(event: { readonly clientX: number; readonly clientY: number }): {
	x: number;
	y: number;
} {
	return { x: Math.round(event.clientX), y: Math.round(event.clientY + CONTEXT_MENU_POINTER_CLEARANCE) };
}
