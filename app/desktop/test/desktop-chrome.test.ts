import { describe, expect, test } from "bun:test";
import {
	COLLAPSED_CHAT_CONTENT_INSET_PX,
	DESKTOP_TOP_BAR_HEIGHT_PX,
	getMacTrafficLightPosition,
	MAC_SIDEBAR_LEADING_INSET_PX,
} from "../shared/desktop-chrome";
import {
	COLLAPSED_CHAT_CONTENT_PADDING_CLASS,
	DESKTOP_TOP_BAR_HEIGHT_CLASS,
	MAC_SIDEBAR_LEADING_PADDING_CLASS,
	MAC_SIDEBAR_LEADING_POSITION_CLASS,
} from "../src/components/shell/desktop-chrome";

describe("desktop chrome geometry", () => {
	test("Synara 的红绿灯与侧栏按钮共享 46px 顶栏中心线", () => {
		expect(DESKTOP_TOP_BAR_HEIGHT_PX).toBe(46);
		expect(getMacTrafficLightPosition()).toEqual({ x: 16, y: 16 });
		expect(MAC_SIDEBAR_LEADING_INSET_PX).toBe(90);
	});

	test("renderer 的静态 Tailwind 类与共享几何常量保持一致", () => {
		expect(DESKTOP_TOP_BAR_HEIGHT_CLASS).toBe("h-[46px]");
		expect(MAC_SIDEBAR_LEADING_PADDING_CLASS).toBe("pl-[90px]");
		expect(MAC_SIDEBAR_LEADING_POSITION_CLASS).toBe("left-[90px]");
		expect(COLLAPSED_CHAT_CONTENT_INSET_PX).toBe(122);
		expect(COLLAPSED_CHAT_CONTENT_PADDING_CLASS).toBe("pl-[122px]");
	});
});
