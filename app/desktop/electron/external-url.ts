/**
 * 普通 `<a>` 点击只导航当前窗口，不会进入 `setWindowOpenHandler`。
 * 应用自己的文档留在窗口里，其余地址交给系统浏览器。
 *
 * `file:` 的 origin 都是 opaque `"null"`，打包后的页面不能靠 origin 区分，改比文档 URL。
 */
export function shouldOpenExternalUrl(currentUrl: string, targetUrl: string): boolean {
	let current: URL;
	let target: URL;
	try {
		current = new URL(currentUrl);
		target = new URL(targetUrl);
	} catch {
		return true;
	}
	if (current.protocol === "file:" || target.protocol === "file:") return target.href !== current.href;
	return current.origin !== target.origin;
}
