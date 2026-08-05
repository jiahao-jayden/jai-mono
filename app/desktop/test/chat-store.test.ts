import { beforeEach, describe, expect, test } from "bun:test";
import { selectDraft, useDesktopChatStore } from "../src/stores/chat";

describe("desktop chat store", () => {
	beforeEach(() => {
		useDesktopChatStore.setState({
			activeSessionId: null,
			drafts: {},
			queue: [],
			selectedModelRef: "",
			selectedWorkspaceId: null,
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

	test("入队和接受队首均通过 message id 精确更新", () => {
		const store = useDesktopChatStore.getState();
		store.setDraft("first");
		store.enqueueMessage("first");
		store.setDraft("second");
		store.enqueueMessage("second");
		const [first, second] = useDesktopChatStore.getState().queue;
		if (!first || !second) throw new Error("expected queued messages");

		store.acceptQueuedMessage(first.id);
		expect(useDesktopChatStore.getState().queue).toEqual([second]);
		expect(selectDraft(useDesktopChatStore.getState())).toBe("");
	});

	test("编辑队列项将内容恢复到当前 draft 并移除该项", () => {
		const store = useDesktopChatStore.getState();
		store.enqueueMessage("queued");
		const queued = useDesktopChatStore.getState().queue[0];
		if (!queued) throw new Error("expected queued message");

		store.editQueuedMessage(queued.id);

		expect(selectDraft(useDesktopChatStore.getState())).toBe("queued");
		expect(useDesktopChatStore.getState().queue).toEqual([]);
	});
});
