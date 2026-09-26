import { beforeEach, describe, expect, test } from "bun:test";
import type { DesktopSessionControls } from "../shared/session-controls";
import { defaultDesktopSessionControls } from "../shared/session-controls";
import { selectDraft, useDesktopChatStore } from "../src/stores/chat";

const planned: DesktopSessionControls = {
	permissionMode: "allow",
	interactionMode: "plan",
	reasoningLevel: "high",
	fastMode: true,
};

describe("desktop chat store", () => {
	beforeEach(() => {
		useDesktopChatStore.setState({
			activeSessionId: null,
			drafts: {},
			queue: [],
			selectedModelRef: null,
			selectedProjectId: null,
			selectedControls: null,
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

	test("首条消息被接受后按创建的 session 清空草稿", () => {
		const store = useDesktopChatStore.getState();
		store.setDraft("first message");
		store.sessionCreated("session-1");
		store.newChat();

		store.clearDraft("session-1");

		expect(useDesktopChatStore.getState().drafts["session-1"]).toBe("");
	});

	test("入队和接受队首均通过 message id 精确更新，且不隐式修改草稿", () => {
		const store = useDesktopChatStore.getState();
		store.setDraft("first");
		store.enqueueMessage("first", defaultDesktopSessionControls, "p/a");
		store.setDraft("second");
		store.enqueueMessage("second", planned, "p/b");
		const [first, second] = useDesktopChatStore.getState().queue;
		if (!first || !second) throw new Error("expected queued messages");

		store.acceptQueuedMessage(first.id);
		expect(useDesktopChatStore.getState().queue).toEqual([second]);
		expect(selectDraft(useDesktopChatStore.getState())).toBe("second");
	});

	test("编辑队列项将内容恢复到当前 draft、移除该项，并交回它排队时的模型与会话控制", () => {
		const store = useDesktopChatStore.getState();
		store.enqueueMessage("queued", planned, "p/b");
		const queued = useDesktopChatStore.getState().queue[0];
		if (!queued) throw new Error("expected queued message");

		const edited = store.editQueuedMessage(queued.id);

		expect(edited).toMatchObject({ text: "queued", controls: planned, modelRef: "p/b" });
		expect(selectDraft(useDesktopChatStore.getState())).toBe("queued");
		expect(useDesktopChatStore.getState().queue).toEqual([]);
	});

	test("切换到新 Session 时不会继承上一 Session 的会话控制", () => {
		const store = useDesktopChatStore.getState();
		store.setSelectedControls(planned);
		store.openSession("session-1");
		store.newChat();

		expect(useDesktopChatStore.getState().selectedControls).toBeNull();
	});
});
