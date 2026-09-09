import { useId, useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { desktop } from "@/lib/desktop";
import { upsertProject } from "@/lib/desktop-query";
import { useIcons } from "@/lib/icon-context";
import type { DesktopProject } from "../../../shared/desktop-rpc";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";

export function CreateProjectDialog({
	open,
	onOpenChange,
	onCreated,
}: {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly onCreated?: (project: DesktopProject) => void | Promise<void>;
}) {
	const intl = useIntl();
	const icons = useIcons();
	const fieldId = useId();
	const [name, setName] = useState("");
	const [directory, setDirectory] = useState("");
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState(false);
	const FolderOpenIcon = icons["folder-open"];

	const changeOpen = (next: boolean) => {
		if (pending) return;
		if (!next) {
			setName("");
			setDirectory("");
			setFailed(false);
		}
		onOpenChange(next);
	};

	const create = async () => {
		setPending(true);
		setFailed(false);
		try {
			const project = await desktop.project.create({ name: name.trim(), path: directory });
			upsertProject(project);
			setPending(false);
			setName("");
			setDirectory("");
			onOpenChange(false);
			await onCreated?.(project);
		} catch {
			setPending(false);
			setFailed(true);
		}
	};

	const pickDirectory = async () => {
		const picked = await desktop.project.pickDirectory();
		if (!picked) return;
		setDirectory(picked);
		if (!name.trim()) setName(picked.split(/[\\/]/).filter(Boolean).at(-1) ?? "");
	};

	return (
		<Dialog open={open} onOpenChange={changeOpen}>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void create();
					}}
				>
					<DialogHeader>
						<DialogTitle>{intl.formatMessage(desktopMessages.projectCreateTitle)}</DialogTitle>
						<DialogDescription>{intl.formatMessage(desktopMessages.projectCreateDescription)}</DialogDescription>
					</DialogHeader>
					<label className="flex flex-col gap-1.5 text-[12px] text-muted-foreground" htmlFor={`${fieldId}-name`}>
						<span>{intl.formatMessage(desktopMessages.projectCreateName)}</span>
						<Input
							id={`${fieldId}-name`}
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder={intl.formatMessage(desktopMessages.projectCreateNamePlaceholder)}
							disabled={pending}
							autoFocus
						/>
					</label>
					<div className="mt-4 flex flex-col gap-1.5 text-[12px] text-muted-foreground">
						<label htmlFor={`${fieldId}-directory`}>
							{intl.formatMessage(desktopMessages.projectCreateDirectory)}
						</label>
						<div className="flex items-center gap-2">
							<Input
								id={`${fieldId}-directory`}
								value={directory}
								readOnly
								placeholder={intl.formatMessage(desktopMessages.projectCreateDirectoryPlaceholder)}
								title={directory}
								onClick={() => void pickDirectory()}
								className="cursor-pointer font-mono text-[12px]"
							/>
							<Button
								type="button"
								variant="tertiary"
								size="icon"
								disabled={pending}
								onClick={() => void pickDirectory()}
								aria-label={intl.formatMessage(desktopMessages.projectCreateBrowse)}
								title={intl.formatMessage(desktopMessages.projectCreateBrowse)}
							>
								<FolderOpenIcon size={16} strokeWidth={1.5} />
							</Button>
						</div>
					</div>
					{failed ? (
						<p className="mt-3 text-[12px] leading-relaxed text-destructive" role="alert">
							{intl.formatMessage(desktopMessages.projectCreateFailed)}
						</p>
					) : null}
					<DialogFooter className="mt-5">
						<Button type="button" variant="ghost" disabled={pending} onClick={() => changeOpen(false)}>
							{intl.formatMessage(desktopMessages.commonCancel)}
						</Button>
						<Button type="submit" variant="primary" loading={pending} disabled={!name.trim() || !directory}>
							{intl.formatMessage(desktopMessages.projectCreateSubmit)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
