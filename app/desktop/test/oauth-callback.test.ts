import { describe, expect, test } from "bun:test";
import { desktopOAuthCallbackUrl, isDesktopOAuthCallbackUrl } from "../electron/oauth-callback";

describe("Desktop OAuth callback server", () => {
	test("accepts only its fixed loopback callback URL", () => {
		expect(isDesktopOAuthCallbackUrl(new URL(desktopOAuthCallbackUrl))).toBe(true);
		expect(isDesktopOAuthCallbackUrl(new URL("http://localhost:43821/v1/oauth/callback"))).toBe(false);
		expect(isDesktopOAuthCallbackUrl(new URL("http://127.0.0.1:43821/other"))).toBe(false);
	});
});
