"use client";

import { cn } from "cn";
import { type ComponentProps, type ComponentType, useMemo } from "react";
import { field, floating } from "@/lib/surfaces";

export interface ComposerCommand {
	name: string;
	description: string;
	icon: ComponentType<{ className?: string }>;
}

/** Commands whose name contains the slash query, or none when not typing one. */
export function useSlashMatches(value: string, commands: readonly ComposerCommand[] | undefined): ComposerCommand[] {
	return useMemo(() => {
		if (!commands || !value.startsWith("/")) return [];
		const query = value.slice(1).toLowerCase();
		return commands.filter((command) => command.name.toLowerCase().includes(query));
	}, [commands, value]);
}

export function ComposerMenu({
	open,
	align = "start",
	className,
	...props
}: ComponentProps<"div"> & { open: boolean; align?: "start" | "end" }) {
	return (
		<div
			data-slot="composer-menu"
			data-open={open || undefined}
			className={cn(
				floating,
				"absolute bottom-full z-10 mb-2 flex w-72 flex-col gap-0.5 rounded-xl p-1.5",
				align === "start" ? "start-0 origin-bottom-left" : "end-0 origin-bottom-right",
				"transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
				open ? "scale-100 opacity-100" : "pointer-events-none scale-[0.97] opacity-0",
				className,
			)}
			{...props}
		/>
	);
}

export function ComposerMenuItem({
	active = false,
	className,
	...props
}: ComponentProps<"button"> & { active?: boolean }) {
	return (
		<button
			type="button"
			data-slot="composer-menu-item"
			data-active={active || undefined}
			className={cn(
				"flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors",
				active ? field : "hover:bg-foreground/[0.04]",
				className,
			)}
			{...props}
		/>
	);
}

export function ComposerCommandItem({
	command,
	active,
	...props
}: Omit<ComponentProps<"button">, "children"> & {
	command: ComposerCommand;
	active: boolean;
}) {
	return (
		<ComposerMenuItem active={active} {...props}>
			<command.icon className="text-foreground/35 size-3.5 shrink-0" />
			<span className="font-medium">/{command.name}</span>
			<span className="text-foreground/45 flex-1 truncate text-start text-xs">{command.description}</span>
			{active && <kbd className="bg-foreground/[0.06] text-foreground/45 rounded px-1 font-mono text-[10px]">↵</kbd>}
		</ComposerMenuItem>
	);
}
