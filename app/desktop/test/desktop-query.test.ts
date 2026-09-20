import { describe, expect, test } from "bun:test";
import type { CodingSession, DesktopSessionListPage } from "../shared/desktop-rpc";
import { getRecentSessions } from "../src/lib/desktop-query";

function session(id: string, lastActivityAt: number, pinnedAt: number | null = null): CodingSession {
	return {
		id,
		projectId: null,
		title: id,
		titleSource: "manual",
		lastActivityAt,
		archivedAt: null,
		pinnedAt,
	};
}

describe("getRecentSessions", () => {
	test("置顶会话排在未置顶之前，其次才是运行中和最近活动", () => {
		const page: DesktopSessionListPage = {
			sessions: [session("old-pinned", 1, 50), session("fresh", 100), session("running", 10)],
			runningSessionIds: ["running"],
		};

		expect(getRecentSessions({ pages: [page], pageParams: [undefined] }).map((item) => item.id)).toEqual([
			"old-pinned",
			"running",
			"fresh",
		]);
	});
});
