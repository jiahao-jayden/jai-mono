"use client";

import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { DesktopCommandDescriptor } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";

interface SlashCommandMenuProps {
	readonly commands: readonly DesktopCommandDescriptor[];
	readonly selectedIndex: number;
	readonly onSelect: (command: DesktopCommandDescriptor) => void;
}

export function slashCommandQuery(value: string): string | undefined {
	const match = /^\/([^\s]*)$/u.exec(value);
	return match?.[1];
}

export function filterSlashCommands(
	commands: readonly DesktopCommandDescriptor[],
	query: string | undefined,
): readonly DesktopCommandDescriptor[] {
	if (query === undefined) return [];
	const normalized = query.toLocaleLowerCase();
	return commands.filter((command) => command.name.toLocaleLowerCase().includes(normalized));
}

export function SlashCommandMenu({ commands, selectedIndex, onSelect }: SlashCommandMenuProps) {
	const intl = useIntl();
	const icons = useIcons();

	return (
		<div
			role="listbox"
			aria-label={intl.formatMessage(desktopMessages.slashCommands)}
			className="mb-2 max-h-72 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-surface-3"
		>
			{commands.map((command, index) => {
				const isSkill = command.commandKind === "skill";
				const Icon = isSkill ? icons.sparkles : icons["file-code"];
				const selected = index === selectedIndex;
				const secondaryText = command.argumentHint ?? command.description;
				return (
					<Button
						key={command.name}
						type="button"
						role="option"
						aria-selected={selected}
						variant="ghost"
						size="sm"
						active={selected}
						className={cn("h-auto w-full justify-start px-2 py-1.5 text-left", selected && "text-foreground")}
						contentClassName="w-full min-w-0 justify-start"
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => onSelect(command)}
					>
						<span className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2">
							<Icon size={16} className="row-span-2 text-muted-foreground" />
							<span className="truncate text-[13px] text-foreground">/{command.name}</span>
							<span className="truncate text-[11px] text-muted-foreground">{secondaryText}</span>
						</span>
					</Button>
				);
			})}
		</div>
	);
}
