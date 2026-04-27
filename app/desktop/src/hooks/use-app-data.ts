import { useEffect, useRef } from "react";
import { gateway } from "@/services/gateway";
import { useChatStore } from "@/stores/chat";
import { useSessionStore } from "@/stores/session";

async function refresh() {
	const [config, sessions] = await Promise.all([gateway.config.get(), gateway.sessions.list()]);

	useChatStore.getState().syncModels(config);
	useSessionStore.getState().setSessions(sessions);
	useChatStore
		.getState()
		.refreshCommands()
		.catch(() => {});
}

export function useAppData() {
	const initialized = useRef(false);

	useEffect(() => {
		if (initialized.current) return;
		initialized.current = true;

		gateway.waitForReady().then(refresh).catch(console.error);
	}, []);

	useEffect(() => {
		const onFocus = () => refresh().catch(console.error);
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, []);
}
