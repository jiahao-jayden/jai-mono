import { useEffect } from "react";
import { useSessionStore } from "@/stores/session";

export function useSessions() {
	const fetchSessions = useSessionStore((s) => s.fetchSessions);

	useEffect(() => {
		fetchSessions();
		const timer = setInterval(fetchSessions, 5000);
		return () => clearInterval(timer);
	}, [fetchSessions]);

	return useSessionStore();
}
