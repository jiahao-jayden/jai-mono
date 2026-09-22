import { cn } from "cn";
import type { MouseEvent, ReactNode } from "react";
import { Button } from "../../ui/button";

export const sidebarRowHoverReserveClassName =
	"transition-[padding] duration-150 ease-out group-hover/row:pr-[3.5rem] group-focus-within/row:pr-[3.5rem]";

export function SidebarRowHover({ children }: { readonly children: ReactNode }) {
	return (
		<div className="group/row relative rounded-lg hover:bg-sidebar-hover focus-within:bg-sidebar-hover">
			{children}
		</div>
	);
}

export function SidebarRowHoverActions({ children }: { readonly children: ReactNode }) {
	return (
		<div
			className={cn(
				"absolute top-1/2 right-1.5 z-10 flex -translate-y-1/2 items-center gap-2",
				"pointer-events-none opacity-0 transition-opacity duration-150",
				"group-hover/row:pointer-events-auto group-hover/row:opacity-100",
				"group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100",
			)}
		>
			{children}
		</div>
	);
}

export function SidebarHoverIconButton({
	label,
	pressed,
	onClick,
	onContextMenu,
	children,
}: {
	readonly label: string;
	readonly pressed?: boolean;
	readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
	readonly onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
	readonly children: ReactNode;
}) {
	return (
		<Button
			type="button"
			variant="navigation"
			size="icon-xs"
			aria-label={label}
			aria-pressed={pressed}
			title={label}
			onContextMenu={onContextMenu}
			onPointerDown={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onClick(event);
			}}
			className="size-5 rounded-sm text-sidebar-muted hover:bg-transparent hover:text-sidebar-foreground [&_svg]:size-[15px]"
		>
			{children}
		</Button>
	);
}
