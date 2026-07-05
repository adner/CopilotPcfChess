/**
 * Bridge viewer (the MCP App). Renders a tool's `structuredContent.html` inside a sandboxed iframe
 * and — for the smoke test — fans the tool's `smoke` payload out to the host as a nudge ON RENDER.
 * A server tool cannot postMessage, so this client-side fan-out is the agent → PCF hop of the bridge.
 *
 * The nudge envelope MUST match what the PCF listens for (keep these two in sync — see the
 * bidirectional-pcf-agent skill):
 *   { eventName: "powerapps.copilot.chat.action", action: "template.chess.moved",
 *     actionData: { fen, san, from, to, status, result } }
 */
import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

const HOST_EVENT = "powerapps.copilot.chat.action";
const HOST_ACTION = "template.chess.moved";

const root = document.getElementById("root")!;
let widgetFrame: HTMLIFrameElement | null = null;
let currentTheme: "light" | "dark" = "light";

const app = new App({ name: "Bridge Viewer", version: "0.1.0" }, {});

function pushTheme() {
  widgetFrame?.contentWindow?.postMessage({ type: "set-theme", theme: currentTheme }, "*");
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) {
  return Object.assign(document.createElement(tag), props);
}
function renderLoading(msg = "Working…") {
  const wrap = el("div", { className: "state-loading" });
  wrap.appendChild(el("span", { className: "spinner" }));
  wrap.appendChild(el("span", { textContent: msg }));
  root.replaceChildren(wrap);
  widgetFrame = null;
}
function renderError(title: string, detail?: string) {
  const wrap = el("div", { className: "state-error" });
  wrap.appendChild(el("strong", { textContent: title }));
  if (detail) wrap.appendChild(el("div", { textContent: detail }));
  root.replaceChildren(wrap);
  widgetFrame = null;
}

/** Fan the nudge out to the host PCF — belt-and-suspenders across frame depths. */
function fanoutNudge(actionData: unknown) {
  const msg = { eventName: HOST_EVENT, action: HOST_ACTION, actionData };
  for (const target of [window.top, window.parent, window.parent?.parent]) {
    try {
      if (target && target !== window) target.postMessage(msg, "*");
    } catch {
      /* try the next frame */
    }
  }
}

function renderContent(html: string) {
  const iframe = el("iframe", { className: "widget-frame" });
  // allow-same-origin is required so any self-fetch inside the widget doesn't hit a null origin.
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.style.height = "220px";
  iframe.addEventListener("load", pushTheme);
  iframe.srcdoc = html;
  root.replaceChildren(iframe);
  widgetFrame = iframe;
}

// Size the outer iframe to the nested widget's reported height.
window.addEventListener("message", (e) => {
  if (!widgetFrame || e.source !== widgetFrame.contentWindow) return;
  const d = e.data as { type?: string; height?: number } | null;
  if (!d || d.type !== "widget-resize" || typeof d.height !== "number") return;
  widgetFrame.style.height = `${Math.max(80, Math.min(d.height, 4000))}px`;
});

app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
    currentTheme = ctx.theme;
    pushTheme();
  }
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
};

app.ontoolinputpartial = () => {
  if (!widgetFrame) renderLoading();
};

app.ontoolresult = (result) => {
  if (result.isError) {
    const text = (result.content ?? []).find((c) => c.type === "text") as { text?: string } | undefined;
    renderError("Tool failed", text?.text);
    return;
  }
  const sc = result.structuredContent as { html?: string; chess?: unknown } | undefined;
  if (!sc?.html) {
    renderError("No content in result");
    return;
  }
  renderContent(sc.html);
  // The agent → PCF hop: fan the chess move out to the host PCF on render.
  if (sc.chess) fanoutNudge(sc.chess);
};

app.onteardown = async () => ({});

renderLoading("Rendering…");

void app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx?.theme) {
    applyDocumentTheme(ctx.theme);
    currentTheme = ctx.theme;
    pushTheme();
  }
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
});
