import { beforeEach, describe, expect, test } from "bun:test";
import { selectDraft, useDesktopChatStore } from "../src/stores/chat";

describe("desktop chat store", () => {
	beforeEach(() => {
		useDesktopChatStore.setState({
			activeSessionId: null,
			drafts: {},
			queue: [],
			selectedModelRef: "",
			selectedProjectId: null,
			selectedAgentMode: "manual",
		});
	});

	test("按 session 保留 draft，并在新建 Session 后转移 new-chat draft", () => {
		const store = useDesktopChatStore.getState();
		store.setDraft("new draft");
		store.sessionCreated("session-1");
		store.setDraft("session draft");
		store.openSession("session-2");
		store.setDraft("second session");
		store.openSession("session-1");

		expect(selectDraft(useDesktopChatStore.getState())).toBe("session draft");
		store.newChat();
		expect(selectDraft(useDesktopChatStore.getState())).toBe("");
	});

	test("入队和接受队首均通过 message id 精确更新，且不隐式修改草稿", () => {
		const store = useDesktopChatStore.getState();
		store.setDraft("first");
		store.enqueueMessage("first", "manual");
		store.setDraft("second");
		store.enqueueMessage("second", "plan");
		const [first, second] = useDesktopChatStore.getState().queue;
		if (!first || !second) throw new Error("expected queued messages");

		store.acceptQueuedMessage(first.id);
		expect(useDesktopChatStore.getState().queue).toEqual([second]);
		expect(selectDraft(useDesktopChatStore.getState())).toBe("second");
	});

	test("编辑队列项将内容恢复到当前 draft 并移除该项", () => {
		const store = useDesktopChatStore.getState();
		store.enqueueMessage("queued", "plan");
		const queued = useDesktopChatStore.getState().queue[0];
		if (!queued) throw new Error("expected queued message");

		store.editQueuedMessage(queued.id);

		expect(selectDraft(useDesktopChatStore.getState())).toBe("queued");
		expect(useDesktopChatStore.getState().queue).toEqual([]);
		expect(useDesktopChatStore.getState().selectedAgentMode).toBe("plan");
	});

	test("模式是应用级选择，不随会话切换而重置", () => {
		const store = useDesktopChatStore.getState();
		store.setSelectedAgentMode("automate");
		store.openSession("session-1");
		store.newChat();

		expect(useDesktopChatStore.getState().selectedAgentMode).toBe("automate");
	});
});
