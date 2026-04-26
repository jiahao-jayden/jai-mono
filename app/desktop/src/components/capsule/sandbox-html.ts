import REACT_RUNTIME from "./react-sandbox-runtime.js?raw";

export interface BuildSandboxHTMLOptions {
	instanceId: string;
	initialData: unknown;
	component: string;
	theme?: "light" | "dark";
	/** Self-contained ESM (React externalized); loaded via Blob URL dynamic import. */
	bundleCode: string;
}

export function buildSandboxHTML(opts: BuildSandboxHTMLOptions): string {
	const instanceIdJson = JSON.stringify(opts.instanceId);
	const dataJson = safeJsonForInlineScript(opts.initialData);
	const themeJson = JSON.stringify(opts.theme ?? null);
	const componentJson = JSON.stringify(opts.component);
	const bundleEscaped = escapeForInlineScript(opts.bundleCode);
	const reactRuntimeEscaped = escapeForInlineScript(REACT_RUNTIME);

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline';">
<style>
  html, body { margin: 0; padding: 0; background: transparent; color: inherit; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 14px; }
  #capsule-root { min-height: 1px; }
</style>
</head>
<body>
<script>
${reactRuntimeEscaped}
</script>
<div id="capsule-root"></div>
<script>
(function () {
  var instanceId = ${instanceIdJson};
  var root = document.getElementById("capsule-root");

  function postToHost(msg) {
    try { window.parent.postMessage(msg, "*"); } catch (_) {}
  }

  window.addEventListener("error", function (e) {
    postToHost({
      type: "capsule/error",
      instanceId: instanceId,
      message: e && e.message ? String(e.message) : "uncaught-error",
      stack: e && e.error && e.error.stack ? String(e.error.stack) : undefined,
    });
  });

  window.addEventListener("unhandledrejection", function (e) {
    var reason = e && e.reason;
    postToHost({
      type: "capsule/error",
      instanceId: instanceId,
      message: reason && reason.message ? String(reason.message) : "unhandled-rejection",
      stack: reason && reason.stack ? String(reason.stack) : undefined,
    });
  });

  if (window.ResizeObserver) {
    var lastW = 0, lastH = 0;
    var ro = new ResizeObserver(function (entries) {
      var rect = entries[0].contentRect;
      var w = Math.round(rect.width), h = Math.round(rect.height);
      if (w === lastW && h === lastH) return;
      lastW = w; lastH = h;
      postToHost({ type: "capsule/resize", instanceId: instanceId, width: w, height: h });
    });
    ro.observe(root);
  }

  window.__CAPSULE_CTX__ = {
    root: root,
    instanceId: instanceId,
    data: ${dataJson},
    theme: ${themeJson},
    component: ${componentJson},
    postToHost: postToHost,
  };
})();
</script>
<script type="module">
(async function () {
  var ctx = window.__CAPSULE_CTX__;
  try {
    var code = ${JSON.stringify(bundleEscaped)};
    var blob = new Blob([code], { type: "application/javascript" });
    var url = URL.createObjectURL(blob);
    var mod = await import(url);
    URL.revokeObjectURL(url);
    var capsule = mod.default;
    if (!capsule || !capsule.components) {
      throw new Error("bundle default export is not a CapsuleRegistry");
    }
    var comp = capsule.components[ctx.component];
    if (!comp || typeof comp.render !== "function") {
      throw new Error("component \\"" + ctx.component + "\\" not found in capsule");
    }
    var React = window.React;
    var ReactDOM = window.ReactDOM;
    if (!React || !ReactDOM || !ReactDOM.createRoot) {
      throw new Error("React runtime not available");
    }
    var element = React.createElement(comp.render, {
      data: ctx.data,
      theme: ctx.theme,
      instanceId: ctx.instanceId,
    });
    ReactDOM.createRoot(ctx.root).render(element);
  } catch (e) {
    ctx.postToHost({
      type: "capsule/error",
      instanceId: ctx.instanceId,
      message: (e && e.message) ? String(e.message) : String(e),
      stack: e && e.stack ? String(e.stack) : undefined,
    });
  }
  queueMicrotask(function () {
    ctx.postToHost({ type: "capsule/ready", instanceId: ctx.instanceId });
  });
})();
</script>
</body>
</html>`;
}

function escapeForInlineScript(code: string): string {
	return code.replace(/<\/(script)/gi, "<\\/$1");
}

function safeJsonForInlineScript(value: unknown): string {
	return JSON.stringify(value ?? null)
		.replace(/<\/(script)/gi, "<\\/$1")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}
