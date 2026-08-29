import { TrajectoryView } from "@jai/trajectory-ui";
import ReactDOM from "react-dom/client";
import "@jai/trajectory-ui/style.css";
import { type BrowserTrajectoryCapability, takeBrowserTrajectoryBootstrap } from "./bootstrap";
import { createHttpTrajectoryDataSource } from "./http-source";
import "./style.css";

const bootstrap = takeBrowserTrajectoryBootstrap(window.location, window.history);
const root = document.getElementById("root");

if (!root) throw new Error("Trajectory root is missing");

if (!bootstrap) {
	ReactDOM.createRoot(root).render(
		<main className="trajectory-browser-error" role="alert">
			<h1>Unable to open trajectory</h1>
			<p>This local preview needs a fresh capability from Jai. Return to Jai and open the Session again.</p>
		</main>,
	);
} else {
	void renderTrajectory(root, bootstrap);
}

async function renderTrajectory(
	root: HTMLElement,
	bootstrap: Exclude<ReturnType<typeof takeBrowserTrajectoryBootstrap>, undefined>,
): Promise<void> {
	const capability = await exchangeBrowserLaunch(bootstrap);
	if (!capability) {
		renderOpenFailure(root);
		return;
	}
	const source = createHttpTrajectoryDataSource(capability);
	ReactDOM.createRoot(root).render(
		<TrajectoryView source={source} sessionId={capability.sessionId} className="trajectory-browser-view" />,
	);
}

async function exchangeBrowserLaunch(
	bootstrap: Exclude<ReturnType<typeof takeBrowserTrajectoryBootstrap>, undefined>,
): Promise<BrowserTrajectoryCapability | undefined> {
	try {
		const response = await fetch(`${bootstrap.origin}/v1/browser-launch`, {
			method: "POST",
			headers: { "x-jai-trajectory-launch": bootstrap.launchId },
			cache: "no-store",
			credentials: "omit",
		});
		const payload = await response.json().catch(() => undefined);
		if (!response.ok || !isLaunchPayload(payload)) return undefined;
		return { origin: bootstrap.origin, sessionId: bootstrap.sessionId, token: payload.token };
	} catch {
		return undefined;
	}
}

function isLaunchPayload(value: unknown): value is { readonly token: string } {
	return (
		typeof value === "object" && value !== null && typeof (value as { readonly token?: unknown }).token === "string"
	);
}

function renderOpenFailure(root: HTMLElement): void {
	ReactDOM.createRoot(root).render(
		<main className="trajectory-browser-error" role="alert">
			<h1>Unable to open trajectory</h1>
			<p>This local preview needs a fresh capability from Jai. Return to Jai and open the Session again.</p>
		</main>,
	);
}
