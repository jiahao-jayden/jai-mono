export const VANILLA_WEATHER_BUNDLE = /* js */ `
const boot = window.__CAPSULE_BOOT__;
if (!boot) throw new Error("no-bootstrap");

const isDark = boot.theme === "dark";

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

const data = boot.initialData || {};

function el(tag, style, text) {
  const n = document.createElement(tag);
  if (style) n.style.cssText = style;
  if (text != null) n.textContent = String(text);
  return n;
}

const header = el("div", "display:flex;align-items:center;justify-content:space-between;gap:12px");
header.appendChild(el("div", "font-size:13px;font-weight:500;opacity:0.7;letter-spacing:0.02em;text-transform:uppercase", data.city || "—"));
const badge = el("div",
  "font-size:11px;padding:2px 8px;border-radius:999px;background:" + (isDark ? "#2a313a" : "#e7ecf2"),
  data.condition || "clear");
header.appendChild(badge);
container.appendChild(header);

const tempRow = el("div", "display:flex;align-items:baseline;gap:6px;margin-top:2px");
tempRow.appendChild(el("span", "font-size:48px;font-weight:700;line-height:1;letter-spacing:-0.02em",
  data.temp == null ? "--" : data.temp));
tempRow.appendChild(el("span", "font-size:20px;opacity:0.55;font-weight:500", "°C"));
container.appendChild(tempRow);
`;

export const VANILLA_COUNTER_BUNDLE = /* js */ `
const boot = window.__CAPSULE_BOOT__;
if (!boot) throw new Error("no-bootstrap");

const root = document.createElement("div");
root.style.cssText = "padding:16px;display:flex;align-items:center;gap:12px;font-family:inherit";
boot.element.appendChild(root);

const data = boot.initialData || {};
const label = document.createElement("span");
label.style.cssText = "font-size:32px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-0.02em";
label.textContent = String(data.count ?? 0);
root.appendChild(label);
`;
