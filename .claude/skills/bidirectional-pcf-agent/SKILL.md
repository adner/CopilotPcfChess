---
name: bidirectional-pcf-agent
description: >-
  Use when designing or debugging the two-way loop between a PCF control and an M365 Copilot declarative
  agent brokered by an MCP server — the nudge/postMessage protocol, shared state over the web plane, and
  the hard runtime constraints (HTTPS/devtunnel, CSP, iframe sandbox). Read this before changing how the
  widget signals the app or how the app reconciles. Triggers: "nudge", "postMessage bridge", "agent to
  PCF", "shared state", "widget-resize", "set-theme", "mixed content", "frame-ancestors", "sandbox
  allow-same-origin", "the loop", "bi-directional".
---

# Bi-directional PCF ↔ declarative agent bridge

The demo concept is a **round-trip**: the PCF sends a prompt into Copilot (app → agent), the agent calls
an MCP tool, and the tool's widget signals a result **back** to the PCF (agent → app). Three moving
parts: the **PCF control** (in the model-driven app), the **MCP (Apps) server** (tools + a viewer
widget), and the **declarative agent** (routes prompts to tools).

## Direction 1 — app → agent
The PCF calls `Xrm.Copilot.openM365CopilotPanel()` then `sendPromptToM365Copilot(prompt, { autoSubmit, gptId })`.
Full API + the gptId gotcha: **xrm-copilot-integration** skill.

## Direction 2 — agent → app (the nudge)
**A server tool cannot `postMessage`.** The fan-out is **client-side, in the MCP Apps widget** (the
viewer, `mcp-app.ts`): when the widget renders a tool result, it posts a nudge to the host. In this
template the smoke-test tool's widget fans out **on render** (so the round-trip is automatic — a
deliberate change from patterns that fan out on a button click).

**The exact nudge envelope (contract — both sides must match byte-for-byte):**
```js
// posted to window.top, window.parent, window.parent.parent (the pane is nested; hit all three)
{
  eventName: "powerapps.copilot.chat.action",
  action:    "template.smoketest.ping",
  actionData: { message: "<string>", ts: "<ISO timestamp>" }
}
```

**The PCF receives via DUAL registration** — belt-and-suspenders, because the pane is a nested iframe
where `addActionHandler` routing can be unreliable:
```ts
copilotApi()?.addActionHandler?.("template.smoketest.ping", (data) => onPing(data));
window.addEventListener("message", (e) => {
  const d = e.data;
  if (d?.eventName === "powerapps.copilot.chat.action" && d?.action === "template.smoketest.ping") onPing(d.actionData);
});
```

## The widget ↔ pane bridge (internal)
Inside the widget iframe, two message types keep it sized and themed:
- **up** (widget → host): `{ type: "widget-resize", height: <px> }` — the widget measures its content
  and asks the host to resize; re-invoke render on resize so charts/layout *reflow*, not scale.
- **down** (host → widget): `{ type: "set-theme", theme: "light" | "dark" }`.

## Shared state — reconcile via the server, don't trust actionData
The **rule:** treat a nudge only as a *"something changed, go look"* trigger; fetch the authoritative
state from the server (the web plane) — never render UI straight from `actionData` (messages can be
missed, doubled, or reordered). The web plane exposes, e.g.:
```
GET /state?k=<stateKey>   ->  { state: { ... } }     # capability-token gated (constant-time compare)
GET /health               ->  { status: "ok", ... }
```
The PCF's `stateKey` property is the capability token.

> **Smoke-test exception:** this template's smoke-test panel *does* render the received `message`
> straight from `actionData` — on purpose, because proving payload delivery **is** the point of the
> smoke test. Real features follow the reconcile rule and re-fetch `/state`.

## Hard runtime constraints (each one silently breaks the loop)
- **HTTPS everywhere (devtunnel).** The PCF runs inside an **HTTPS** Power App, so an `http://localhost`
  server URL is **silently blocked as mixed content** — often with no console error. Run the server
  behind an HTTPS devtunnel and set **all** of `PUBLIC_BASE_URL` (server), the PCF `serverBaseUrl`
  property, and the manifest `external-service-usage` domain to that same HTTPS base.
- **CSP.** A framed component page must send `Content-Security-Policy: frame-ancestors https://*.dynamics.com …`
  (or Power Apps refuses to frame it). If the framed page fetches its own data, its meta-CSP needs
  `connect-src 'self'`; if it embeds images as data URIs, `img-src data:`.
- **iframe `sandbox` must include `allow-same-origin`.** Without it the framed component gets an opaque
  origin and every self-`fetch` of its own `/data`/`/state` becomes a **null-origin CORS failure**. Use
  `sandbox="allow-scripts allow-same-origin"`.

## Config coupling to keep ambient
`PUBLIC_BASE_URL` (server `.env`) ↔ PCF `serverBaseUrl` ↔ manifest `external-service-usage` domain —
all three must equal the current HTTPS devtunnel base. Changing the tunnel = update all three (and the
manifest change means a version bump + push).

See also: **xrm-copilot-integration** (the send side + gptId), **mcp-apps-tool-dev** (writing the tool
whose widget fans the nudge), **bridge-troubleshooting** (symptom → cause when it goes silent).
