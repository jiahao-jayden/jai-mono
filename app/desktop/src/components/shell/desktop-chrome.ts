import type {
	COLLAPSED_CHAT_CONTENT_INSET_PX,
	DESKTOP_TOP_BAR_HEIGHT_PX,
	MAC_SIDEBAR_LEADING_INSET_PX,
} from "../../../shared/desktop-chrome";

export const DESKTOP_TOP_BAR_HEIGHT_CLASS: `h-[${typeof DESKTOP_TOP_BAR_HEIGHT_PX}px]` = "h-[46px]";
export const MAC_SIDEBAR_LEADING_PADDING_CLASS: `pl-[${typeof MAC_SIDEBAR_LEADING_INSET_PX}px]` = "pl-[90px]";
export const MAC_SIDEBAR_LEADING_POSITION_CLASS: `left-[${typeof MAC_SIDEBAR_LEADING_INSET_PX}px]` = "left-[90px]";
export const COLLAPSED_CHAT_CONTENT_PADDING_CLASS: `pl-[${typeof COLLAPSED_CHAT_CONTENT_INSET_PX}px]` = "pl-[122px]";
