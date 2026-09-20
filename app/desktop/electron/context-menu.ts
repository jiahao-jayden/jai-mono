import { type BrowserWindow, Menu, type MenuItemConstructorOptions, nativeImage } from "electron";
import type { DesktopContextMenuItem, DesktopContextMenuPosition } from "../shared/desktop-rpc";

/** macOS clips the last few characters of native menu labels without this pad. */
const MAC_CONTEXT_MENU_LABEL_TRAILING_PADDING = "\u2003\u2003";
const CONTEXT_MENU_ICON_DATA_URL_PREFIX = "data:image/png;base64,";
const CONTEXT_MENU_ICON_MAX_DATA_URL_LENGTH = 64_000;

let destructiveMenuIconCache: Electron.NativeImage | null | undefined;

function getDestructiveMenuIcon(): Electron.NativeImage | undefined {
	if (process.platform !== "darwin") return undefined;
	if (destructiveMenuIconCache !== undefined) return destructiveMenuIconCache ?? undefined;
	try {
		const icon = nativeImage.createFromNamedImage("trash").resize({ width: 14, height: 14 });
		if (icon.isEmpty()) {
			destructiveMenuIconCache = null;
			return undefined;
		}
		icon.setTemplateImage(true);
		destructiveMenuIconCache = icon;
		return icon;
	} catch {
		destructiveMenuIconCache = null;
		return undefined;
	}
}

function createContextMenuIcon(dataUrl: string | undefined): Electron.NativeImage | undefined {
	if (
		process.platform !== "darwin" ||
		typeof dataUrl !== "string" ||
		dataUrl.length > CONTEXT_MENU_ICON_MAX_DATA_URL_LENGTH ||
		!dataUrl.startsWith(CONTEXT_MENU_ICON_DATA_URL_PREFIX)
	) {
		return undefined;
	}
	const icon = nativeImage.createFromBuffer(
		Buffer.from(dataUrl.slice(CONTEXT_MENU_ICON_DATA_URL_PREFIX.length), "base64"),
		{ scaleFactor: 2 },
	);
	if (icon.isEmpty()) return undefined;
	icon.setTemplateImage(true);
	return icon;
}

function nativeContextMenuTemplate(
	items: readonly DesktopContextMenuItem[],
	platform: NodeJS.Platform,
	onSelect: (id: string) => void,
): MenuItemConstructorOptions[] {
	const template: MenuItemConstructorOptions[] = [];
	let hasInsertedDestructiveSeparator = false;
	for (const item of items) {
		const shouldInsertSeparator =
			item.separatorBefore === true ||
			(item.destructive === true && !hasInsertedDestructiveSeparator && template.length > 0);
		if (shouldInsertSeparator && template.length > 0) {
			template.push({ type: "separator" });
		}
		if (item.destructive === true) hasInsertedDestructiveSeparator = true;
		const icon = createContextMenuIcon(item.iconDataUrl) ?? (item.destructive ? getDestructiveMenuIcon() : undefined);
		template.push({
			label: platform === "darwin" ? `${item.label}${MAC_CONTEXT_MENU_LABEL_TRAILING_PADDING}` : item.label,
			...(icon ? { icon } : {}),
			click: () => onSelect(item.id),
		});
	}
	return template;
}

export function showNativeContextMenu(
	window: BrowserWindow | null,
	items: readonly DesktopContextMenuItem[],
	position?: DesktopContextMenuPosition,
): Promise<string | null> {
	if (!window) return Promise.resolve(null);
	return new Promise((resolve) => {
		let settled = false;
		const finish = (id: string | null) => {
			if (settled) return;
			settled = true;
			resolve(id);
		};
		const popupPosition =
			position && Number.isFinite(position.x) && Number.isFinite(position.y) && position.x >= 0 && position.y >= 0
				? { x: Math.floor(position.x), y: Math.floor(position.y) }
				: {};
		Menu.buildFromTemplate(nativeContextMenuTemplate(items, process.platform, finish)).popup({
			window,
			...popupPosition,
			callback: () => finish(null),
		});
	});
}
