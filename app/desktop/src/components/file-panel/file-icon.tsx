import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import manifest from "./icon-manifest.json";

const svgModules = import.meta.glob<string>(
	"/node_modules/material-icon-theme/icons/*.svg",
	{ eager: true, query: "?raw", import: "default" },
);

function normalizeSvgKey(name: string): string {
	for (const key of Object.keys(svgModules)) {
		if (key.endsWith(`/${name}.svg`)) return key;
	}
	return "";
}

function getSvg(iconName: string): string | null {
	const key = normalizeSvgKey(iconName);
	return key ? svgModules[key] ?? null : null;
}

function resolveFileIconName(fileName: string): string {
	const lower = fileName.toLowerCase();

	const byName = (manifest.fileNames as Record<string, string>)[lower];
	if (byName) return byName;

	const dot = lower.lastIndexOf(".");
	if (dot !== -1) {
		const ext = lower.slice(dot + 1);
		const byExt = (manifest.fileExtensions as Record<string, string>)[ext];
		if (byExt) return byExt;
	}

	return manifest.file ?? "file";
}

function resolveFolderIconName(folderName: string, expanded: boolean): string {
	const lower = folderName.toLowerCase();
	const folderNames = manifest.folderNames as Record<string, string>;
	const folderNamesExpanded = manifest.folderNamesExpanded as Record<string, string>;

	if (expanded && folderNamesExpanded[lower]) {
		return folderNamesExpanded[lower];
	}

	if (folderNames[lower]) {
		return expanded
			? (folderNamesExpanded[lower] ?? manifest.folderExpanded ?? "folder-open")
			: folderNames[lower];
	}

	return expanded
		? (manifest.folderExpanded ?? "folder-open")
		: (manifest.folder ?? "folder");
}

interface FileTypeIconProps {
	fileName: string;
	className?: string;
}

interface FolderTypeIconProps {
	folderName: string;
	expanded: boolean;
	className?: string;
}

export const FileTypeIcon = memo(function FileTypeIcon({
	fileName,
	className,
}: FileTypeIconProps) {
	const svg = useMemo(() => {
		const iconName = resolveFileIconName(fileName);
		return getSvg(iconName);
	}, [fileName]);

	if (!svg) return <span className={cn("size-4 shrink-0", className)} />;

	return (
		<span
			className={cn("inline-flex items-center justify-center size-4 shrink-0 [&>svg]:size-full", className)}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: trusted SVGs from material-icon-theme npm package
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
});

export const FolderTypeIcon = memo(function FolderTypeIcon({
	folderName,
	expanded,
	className,
}: FolderTypeIconProps) {
	const svg = useMemo(() => {
		const iconName = resolveFolderIconName(folderName, expanded);
		return getSvg(iconName);
	}, [folderName, expanded]);

	if (!svg) return <span className={cn("size-4 shrink-0", className)} />;

	return (
		<span
			className={cn("inline-flex items-center justify-center size-4 shrink-0 [&>svg]:size-full", className)}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: trusted SVGs from material-icon-theme npm package
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
});
