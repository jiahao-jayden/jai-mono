import { BookOpen02Icon, FavouriteIcon, Package02Icon, SourceCodeIcon, SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { SettingsGroup, SettingsHeader, SettingsPage, SettingsRow } from "./common/settings-layout";

export function AboutPane() {
	return (
		<SettingsPage>
			<SettingsHeader title="About" description="A crafted coding companion — built slowly, for thoughtful work." />

			<SettingsGroup title="Application">
				<SettingsRow
					icon={SparklesIcon}
					title="JAI"
					description="Your local-first agentic workbench."
					control={
						<span className="inline-flex items-center rounded-md bg-muted/60 px-2 py-0.5 font-mono text-[11.5px] text-foreground/80 ring-1 ring-border/45">
							0.0.0
						</span>
					}
				/>
				<SettingsRow
					icon={Package02Icon}
					title="Channel"
					description="You are on the developer build. Updates ship straight from source."
					control={<span className="font-serif text-[12.5px] italic text-muted-foreground/65">early access</span>}
				/>
			</SettingsGroup>

			<SettingsGroup title="Community">
				<SettingsRow
					icon={BookOpen02Icon}
					title="Guides"
					description="Workflow notes, architecture, and design principles."
					control={
						<a
							href="https://github.com/jayden-jiahao/jai-mono"
							target="_blank"
							rel="noopener noreferrer"
							className="text-[12.5px] text-primary-2 underline decoration-primary-2/60 underline-offset-4 transition-colors hover:decoration-primary-2"
						>
							Read
						</a>
					}
				/>
				<SettingsRow
					icon={SourceCodeIcon}
					title="Source"
					description="Report issues, read the code, send a patch."
					control={
						<a
							href="https://github.com/jayden-jiahao/jai-mono"
							target="_blank"
							rel="noopener noreferrer"
							className="text-[12.5px] text-primary-2 underline decoration-primary-2/60 underline-offset-4 transition-colors hover:decoration-primary-2"
						>
							GitHub
						</a>
					}
				/>
			</SettingsGroup>

			<p className="mx-1 flex items-center gap-1.5 font-serif text-[12.5px] italic text-muted-foreground/55">
				Made with
				<HugeiconsIcon icon={FavouriteIcon} size={12} strokeWidth={2} className="text-primary-2/80" />
				in a quiet corner of the internet.
			</p>
		</SettingsPage>
	);
}
