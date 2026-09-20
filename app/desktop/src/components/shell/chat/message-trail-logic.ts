import type { DesktopTranscriptItem } from "../../../../shared/desktop-rpc";
import type { TranscriptRow } from "./chat-transcript";

export interface MessageTrailItem {
	readonly id: string;
	readonly ordinal: number;
	readonly promptPreview: string;
	readonly assistantPreview: string;
}

export interface MessageTrailAnchor {
	readonly id: string;
	readonly rowIndex: number;
}

export interface ActiveTrailSnapshot {
	readonly currentId: string | null;
	readonly visibleIds: readonly string[];
}

export interface ActiveTrailStore {
	getSnapshot(): ActiveTrailSnapshot;
	setSnapshot(snapshot: ActiveTrailSnapshot | null): void;
	subscribe(listener: () => void): () => void;
}

export interface TrailGeometry {
	readonly spacing: number;
	readonly centerYs: readonly number[];
	readonly contentHeight: number;
}

export interface TrailTickStyle {
	readonly width: number;
	readonly opacity: number;
}

export const emptyActiveTrailSnapshot: ActiveTrailSnapshot = { currentId: null, visibleIds: [] };

const previewLimit = 280;

function preview(text: string): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= previewLimit) return normalized;
	return `${normalized.slice(0, previewLimit).trimEnd()}…`;
}

export function deriveMessageTrailItems(items: readonly DesktopTranscriptItem[]): readonly MessageTrailItem[] {
	const trailItems: MessageTrailItem[] = [];
	let currentTurn = -1;

	for (const item of items) {
		if (item.kind !== "message") continue;
		if (item.role === "user") {
			trailItems.push({
				id: item.id,
				ordinal: trailItems.length + 1,
				promptPreview: preview(item.text),
				assistantPreview: "",
			});
			currentTurn = trailItems.length - 1;
			continue;
		}
		if (item.role === "assistant" && currentTurn >= 0) {
			const assistantPreview = preview(item.text);
			if (assistantPreview) trailItems[currentTurn] = { ...trailItems[currentTurn]!, assistantPreview };
		}
	}

	return trailItems;
}

export function deriveMessageTrailAnchors(rows: readonly TranscriptRow[]): readonly MessageTrailAnchor[] {
	const anchors: MessageTrailAnchor[] = [];
	for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
		const row = rows[rowIndex]!;
		if ("kind" in row && row.kind === "message" && row.role === "user") {
			anchors.push({ id: row.id, rowIndex });
		}
	}
	return anchors;
}

function equalIdLists(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((id, index) => id === right[index]);
}

export function equalActiveTrailSnapshots(left: ActiveTrailSnapshot, right: ActiveTrailSnapshot): boolean {
	return left.currentId === right.currentId && equalIdLists(left.visibleIds, right.visibleIds);
}

export function resolveActiveTrailSnapshot(
	anchors: readonly MessageTrailAnchor[],
	topVisibleRowIndex: number,
	bottomVisibleRowIndex: number,
): ActiveTrailSnapshot {
	if (anchors.length === 0 || !Number.isFinite(topVisibleRowIndex)) return emptyActiveTrailSnapshot;

	let currentId = anchors[0]!.id;
	const visibleIds: string[] = [];
	const bottom = Number.isFinite(bottomVisibleRowIndex)
		? Math.max(topVisibleRowIndex, bottomVisibleRowIndex)
		: topVisibleRowIndex;
	for (const anchor of anchors) {
		if (anchor.rowIndex <= topVisibleRowIndex) currentId = anchor.id;
		if (anchor.rowIndex >= topVisibleRowIndex && anchor.rowIndex <= bottom) visibleIds.push(anchor.id);
	}
	return { currentId, visibleIds };
}

export function createActiveTrailStore(): ActiveTrailStore {
	let snapshot = emptyActiveTrailSnapshot;
	const listeners = new Set<() => void>();

	return {
		getSnapshot() {
			return snapshot;
		},
		setSnapshot(next) {
			const resolved = next ?? emptyActiveTrailSnapshot;
			if (equalActiveTrailSnapshots(snapshot, resolved)) return;
			snapshot = resolved;
			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

export function computeTrailGeometry(count: number, spacing = 10, padding = 12): TrailGeometry | null {
	if (count <= 0) return null;
	const resolvedSpacing = count === 1 ? 0 : spacing;
	const centerYs = Array.from({ length: count }, (_, index) => padding + index * resolvedSpacing);
	return { spacing: resolvedSpacing, centerYs, contentHeight: padding * 2 + (count - 1) * resolvedSpacing };
}

export function computeFocusedTrailIndex(pointerY: number, geometry: TrailGeometry): number {
	if (!Number.isFinite(pointerY) || geometry.spacing === 0) return 0;
	const last = geometry.centerYs.length - 1;
	const raw = Math.round((pointerY - geometry.centerYs[0]!) / geometry.spacing);
	return Math.max(0, Math.min(last, raw));
}

export function computeDockTickStyles(
	geometry: TrailGeometry,
	pointerY: number,
	activeIndex: number,
	visibleIndexes: ReadonlySet<number>,
): readonly TrailTickStyle[] {
	const sigma = Math.max(8, Math.min(22, geometry.spacing * 1.5));
	return geometry.centerYs.map((centerY, index) => {
		const distance = centerY - pointerY;
		const weight =
			geometry.spacing === 0
				? Number(index === activeIndex)
				: Math.exp(-(distance * distance) / (2 * sigma * sigma));
		const opacity = index === activeIndex ? 1 : visibleIndexes.has(index) ? 0.52 : 0.2;
		return { width: 6 + 24 * weight, opacity };
	});
}
