export interface BuildSandboxHTMLOptions {
	instanceId: string;
	initialData: unknown;
	theme?: "light" | "dark";
	/** Self-contained ESM; inlined into a `<script type="module">`. */
	bundleCode: string;
}

export function buildSandboxHTML(opts: BuildSandboxHTMLOptions): string {
	const instanceIdJson = JSON.stringify(opts.instanceId);
	const dataJson = safeJsonForInlineScript(opts.initialData);
	const themeJson = JSON.stringify(opts.theme ?? null);
	const bundleEscaped = escapeForInlineScript(opts.bundleCode);

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; color: inherit; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 14px; }
  #capsule-root { min-height: 1px; }
</style>
</head>
<body>
<div id="capsule-root"></div>
<script>
(function () {
  var instanceId = ${instanceIdJson};
  var root = document.getElementById("capsule-root");
  var updateHandlers = [];
  var disposeHandlers = [];
  var pendingActions = new Map();
  var disposed = false;

  function postToHost(msg) {
    try { window.parent.postMessage(msg, "*"); } catch (_) {}
  }

  function safeRun(fn) {
    try { fn(); } catch (e) {
      postToHost({
        type: "capsule/error",
        instanceId: instanceId,
        message: (e && e.message) ? String(e.message) : String(e),
        stack: e && e.stack ? String(e.stack) : undefined,
      });
    }
  }

  window.__CAPSULE_BOOT__ = {
    element: root,
    instanceId: instanceId,
    initialData: ${dataJson},
    props: {
      instanceId: instanceId,
      theme: ${themeJson},
      postAction: function (actionId, args) {
        return new Promise(function (resolve, reject) {
          if (disposed) {
            reject(new Error("capsule-disposed"));
            return;
          }
          var requestId = "req-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
          pendingActions.set(requestId, { resolve: resolve, reject: reject });
          postToHost({
            type: "capsule/action",
            instanceId: instanceId,
            actionId: String(actionId),
            requestId: requestId,
            args: args,
          });
        });
      },
    },
    onUpdate: function (handler) {
      updateHandlers.push(handler);
      return function () {
        updateHandlers = updateHandlers.filter(function (h) { return h !== handler; });
      };
    },
    onDispose: function (handler) {
      disposeHandlers.push(handler);
      return function () {
        disposeHandlers = disposeHandlers.filter(function (h) { return h !== handler; });
      };
    },
  };

  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || typeof m !== "object") return;
    if (m.instanceId !== instanceId) return;
    switch (m.type) {
      case "capsule/update":
        updateHandlers.slice().forEach(function (h) {
          safeRun(function () { h(m.data); });
        });
        break;
      case "capsule/action_result":
        var pending = pendingActions.get(m.requestId);
        if (!pending) return;
        pendingActions.delete(m.requestId);
        if (m.ok) pending.resolve(m.result);
        else pending.reject(new Error(m.error || "action-failed"));
        break;
      case "capsule/dispose":
        if (disposed) return;
        disposed = true;
        disposeHandlers.slice().forEach(function (h) {
          safeRun(function () { h(); });
        });
        updateHandlers = [];
        disposeHandlers = [];
        pendingActions.clear();
        break;
    }
  });

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
})();
</script>
<script type="module">
try {
${bundleEscaped}
} catch (e) {
  window.parent.postMessage({
    type: "capsule/error",
    instanceId: ${instanceIdJson},
    message: (e && e.message) ? String(e.message) : String(e),
    stack: e && e.stack ? String(e.stack) : undefined,
  }, "*");
}
queueMicrotask(function () {
  window.parent.postMessage({ type: "capsule/ready", instanceId: ${instanceIdJson} }, "*");
});
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
