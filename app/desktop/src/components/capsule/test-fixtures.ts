// Hand-written vanilla-JS capsule bundles (no React) used by the playground
// to validate the protocol before the real builder CLI lands.

export const VANILLA_WEATHER_BUNDLE = /* js */ `
const boot = window.__CAPSULE_BOOT__;
if (!boot) throw new Error("no-bootstrap");

const theme = boot.props.theme || "light";
const isDark = theme === "dark";

const container = document.createElement("div");
container.style.cssText = [
  "padding:20px 22px",
  "border-radius:12px",
  "display:flex",
  "flex-direction:column",
  "gap:6px",
  "background:" + (isDark ? "#111418" : "#f8f9fb"),
  "color:" + (isDark ? "#e6e8ec" : "#1d1f23"),
].join(";");
boot.element.appendChild(container);

let currentData = boot.initialData;

function el(tag, style, text) {
  const n = document.createElement(tag);
  if (style) n.style.cssText = style;
  if (text != null) n.textContent = String(text);
  return n;
}

function render(data) {
  currentData = data || {};
  container.innerHTML = "";
  const header = el("div", "display:flex;align-items:center;justify-content:space-between;gap:12px");
  header.appendChild(el("div", "font-size:13px;font-weight:500;opacity:0.7;letter-spacing:0.02em;text-transform:uppercase", currentData.city || "—"));
  const badge = el("div",
    "font-size:11px;padding:2px 8px;border-radius:999px;background:" + (isDark ? "#2a313a" : "#e7ecf2"),
    currentData.condition || "clear");
  header.appendChild(badge);
  container.appendChild(header);

  const tempRow = el("div", "display:flex;align-items:baseline;gap:6px;margin-top:2px");
  tempRow.appendChild(el("span", "font-size:48px;font-weight:700;line-height:1;letter-spacing:-0.02em",
    currentData.temp == null ? "--" : currentData.temp));
  tempRow.appendChild(el("span", "font-size:20px;opacity:0.55;font-weight:500", "°C"));
  container.appendChild(tempRow);

  const actions = el("div", "display:flex;gap:8px;margin-top:10px");
  const refresh = el("button",
    "padding:6px 14px;border-radius:8px;border:1px solid " + (isDark ? "#323a45" : "#d5dbe3")
    + ";background:transparent;color:inherit;cursor:pointer;font-size:12px;font-weight:500;font-family:inherit",
    "Refresh");
  refresh.addEventListener("click", async () => {
    refresh.disabled = true;
    refresh.textContent = "Loading…";
    try {
      await boot.props.postAction("refresh", { city: currentData.city });
    } catch (e) {
      refresh.textContent = "Failed";
      setTimeout(() => { refresh.disabled = false; refresh.textContent = "Refresh"; }, 800);
      return;
    }
    refresh.disabled = false;
    refresh.textContent = "Refresh";
  });
  actions.appendChild(refresh);
  container.appendChild(actions);
}

render(boot.initialData);
boot.onUpdate(render);
boot.onDispose(() => { container.remove(); });
`;

export const VANILLA_COUNTER_BUNDLE = /* js */ `
const boot = window.__CAPSULE_BOOT__;
if (!boot) throw new Error("no-bootstrap");

const root = document.createElement("div");
root.style.cssText = "padding:16px;display:flex;align-items:center;gap:12px;font-family:inherit";
boot.element.appendChild(root);

let current = boot.initialData || {};
const label = document.createElement("span");
label.style.cssText = "font-size:32px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-0.02em";
root.appendChild(label);

const inc = document.createElement("button");
inc.textContent = "+1";
inc.style.cssText = "padding:6px 12px;border-radius:8px;border:1px solid #d5dbe3;background:transparent;color:inherit;cursor:pointer";
inc.addEventListener("click", () => boot.props.postAction("increment", { by: 1 }));
root.appendChild(inc);

const dec = document.createElement("button");
dec.textContent = "-1";
dec.style.cssText = "padding:6px 12px;border-radius:8px;border:1px solid #d5dbe3;background:transparent;color:inherit;cursor:pointer";
dec.addEventListener("click", () => boot.props.postAction("increment", { by: -1 }));
root.appendChild(dec);

function render(data) {
  current = data || {};
  label.textContent = String(current.count ?? 0);
}
render(current);
boot.onUpdate(render);
boot.onDispose(() => { root.remove(); });
`;
