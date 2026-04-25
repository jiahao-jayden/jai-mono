import { useCallback, useMemo, useRef, useState } from "react";
import { CapsuleHost } from "@/components/capsule";
import { VANILLA_COUNTER_BUNDLE, VANILLA_WEATHER_BUNDLE } from "@/components/capsule/test-fixtures";
import { Titlebar } from "@/components/shell/titlebar";
import { cn } from "@/lib/utils";

type FixtureId = "weather" | "counter";

interface Fixture {
	id: FixtureId;
	label: string;
	bundle: string;
	initial: Record<string, unknown>;
}

const FIXTURES: Record<FixtureId, Fixture> = {
	weather: {
		id: "weather",
		label: "Weather",
		bundle: VANILLA_WEATHER_BUNDLE,
		initial: { city: "Shanghai", temp: 22, condition: "Clear" },
	},
	counter: {
		id: "counter",
		label: "Counter",
		bundle: VANILLA_COUNTER_BUNDLE,
		initial: { count: 0 },
	},
};

export default function CapsulePlaygroundView() {
	const [fixtureId, setFixtureId] = useState<FixtureId>("weather");
	const [theme, setTheme] = useState<"light" | "dark">("light");
	const [data, setData] = useState<Record<string, unknown>>(FIXTURES.weather.initial);
	const [log, setLog] = useState<LogEntry[]>([]);
	const counterRef = useRef(0);

	const fixture = FIXTURES[fixtureId];

	const appendLog = useCallback((kind: LogEntry["kind"], text: string) => {
		setLog((xs) => {
			const next: LogEntry = { id: ++counterRef.current, kind, text, at: new Date() };
			return [...xs.slice(-99), next];
		});
	}, []);

	const handleSelectFixture = useCallback((id: FixtureId) => {
		setFixtureId(id);
		setData(FIXTURES[id].initial);
		setLog([]);
	}, []);

	const handleReady = useCallback(() => appendLog("ready", "capsule ready"), [appendLog]);
	const handleError = useCallback((m: string) => appendLog("error", m), [appendLog]);

	const instanceId = useMemo(() => `pg-${fixtureId}`, [fixtureId]);

	return (
		<div className="flex h-svh flex-col bg-background text-foreground">
			<Titlebar className="border-b border-border/40">
				<div className="ml-1 text-sm font-medium">Capsule Playground</div>
			</Titlebar>

			<div className="flex min-h-0 flex-1">
				<aside className="flex w-64 shrink-0 flex-col gap-5 border-r border-border/40 p-4">
					<Section title="Fixture">
						<div className="flex flex-col gap-1">
							{(Object.keys(FIXTURES) as FixtureId[]).map((id) => (
								<button
									type="button"
									key={id}
									onClick={() => handleSelectFixture(id)}
									className={cn(
										"rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
										fixtureId === id
											? "bg-accent text-foreground"
											: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
									)}
								>
									{FIXTURES[id].label}
								</button>
							))}
						</div>
					</Section>

					<Section title="Theme">
						<div className="flex gap-1">
							{(["light", "dark"] as const).map((t) => (
								<button
									type="button"
									key={t}
									onClick={() => setTheme(t)}
									className={cn(
										"flex-1 rounded-md px-2 py-1 text-xs capitalize transition-colors",
										theme === t
											? "bg-accent text-foreground"
											: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
									)}
								>
									{t}
								</button>
							))}
						</div>
					</Section>

					<Section title="Data (JSON)">
						<JsonEditor value={data} onChange={setData} />
					</Section>
				</aside>

				<main className="flex min-w-0 flex-1 flex-col gap-3 p-4">
					<div className="rounded-xl border border-border/60 bg-card p-3">
						<div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-2">Preview</div>
						<div className="overflow-hidden rounded-lg border border-border/40" style={{ height: 260 }}>
							<CapsuleHost
								instanceId={instanceId}
								bundleCode={fixture.bundle}
								data={data}
								theme={theme}
								onReady={handleReady}
								onError={handleError}
							/>
						</div>
					</div>

					<div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border/60 bg-card">
						<div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
							<div className="text-[11px] uppercase tracking-wider text-muted-foreground/70">Event log</div>
							<button
								type="button"
								onClick={() => setLog([])}
								className="text-[11px] text-muted-foreground/70 hover:text-foreground"
							>
								clear
							</button>
						</div>
						<div className="flex-1 overflow-auto font-mono text-[11px] leading-[1.5]">
							{log.length === 0 ? (
								<div className="p-3 text-muted-foreground/50">No events yet.</div>
							) : (
								<ul>
									{log.map((e) => (
										<li
											key={e.id}
											className="grid grid-cols-[76px_56px_1fr] items-start gap-2 border-b border-border/30 px-3 py-1.5"
										>
											<span className="text-muted-foreground/60">{formatTime(e.at)}</span>
											<span className={logKindClass(e.kind)}>{e.kind}</span>
											<span className="break-all whitespace-pre-wrap">{e.text}</span>
										</li>
									))}
								</ul>
							)}
						</div>
					</div>
				</main>
			</div>
		</div>
	);
}

interface LogEntry {
	id: number;
	kind: "ready" | "error";
	text: string;
	at: Date;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-2">
			<div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{title}</div>
			{children}
		</div>
	);
}

function JsonEditor({
	value,
	onChange,
}: {
	value: Record<string, unknown>;
	onChange: (next: Record<string, unknown>) => void;
}) {
	const [text, setText] = useState(() => JSON.stringify(value, null, 2));
	const [error, setError] = useState<string | null>(null);
	const lastValueRef = useRef(value);

	if (lastValueRef.current !== value) {
		lastValueRef.current = value;
		setText(JSON.stringify(value, null, 2));
		setError(null);
	}

	return (
		<div className="flex flex-col gap-1">
			<textarea
				value={text}
				onChange={(e) => {
					const next = e.target.value;
					setText(next);
					try {
						const parsed = JSON.parse(next);
						if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
							setError(null);
							onChange(parsed as Record<string, unknown>);
						} else {
							setError("must be an object");
						}
					} catch (err) {
						setError(err instanceof Error ? err.message : "invalid JSON");
					}
				}}
				rows={8}
				spellCheck={false}
				className="w-full resize-none rounded-md border border-border/60 bg-background px-2 py-1.5 font-mono text-[11px] leading-[1.5] focus:outline-none focus:ring-1 focus:ring-ring"
			/>
			{error && <div className="text-[10px] text-destructive">{error}</div>}
		</div>
	);
}

function logKindClass(kind: LogEntry["kind"]): string {
	switch (kind) {
		case "ready":
			return "text-emerald-500";
		case "error":
			return "text-destructive";
	}
}

function formatTime(d: Date): string {
	const h = d.getHours().toString().padStart(2, "0");
	const m = d.getMinutes().toString().padStart(2, "0");
	const s = d.getSeconds().toString().padStart(2, "0");
	const ms = d.getMilliseconds().toString().padStart(3, "0");
	return `${h}:${m}:${s}.${ms}`;
}
