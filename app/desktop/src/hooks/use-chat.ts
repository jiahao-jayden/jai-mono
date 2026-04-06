import { useEffect } from "react";
import { useChatStore } from "@/stores/chat";

export function useChat() {
	const init = useChatStore((s) => s.init);

	useEffect(() => {
		init();
	}, [init]);

	return useChatStore();
}
