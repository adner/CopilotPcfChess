---
name: xrm-copilot-integration
description: >-
  Use when wiring the Xrm.Copilot client APIs in a model-driven Power Apps demo — opening the M365
  Copilot pane, sending prompts to a declarative agent (with gptId), or receiving agent actions. Covers
  usage from BOTH a PCF control and an MCP Apps widget, the ambient-typing pattern for window.Xrm, and
  the gptId discovery gotcha. Triggers: "Xrm.Copilot", "openM365CopilotPanel", "sendPromptToM365Copilot",
  "sendPrompt to agent", "addActionHandler", "getCurrentAgent", "gptId", "agentId", "open the Copilot panel".
---

# Xrm.Copilot integration (model-driven Power Apps ↔ M365 Copilot)

`window.Xrm.Copilot` is the client bridge between a model-driven app surface (a PCF control) and the
M365 Copilot pane hosting your declarative agent. It is **ambient** — injected by the model-driven host
at runtime, present when your control runs inside the app, absent in the PCF test harness.

Reference docs (for depth — the load-bearing rules are inlined below):
- https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/xrm-copilot
- https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/bring-intelligence-using-agent-apis

## The surface you actually use

| API | Direction | Purpose |
|---|---|---|
| `isM365CopilotEnabled()` | — | Feature gate; call before assuming the panel exists. |
| `openM365CopilotPanel()` | app → host | Opens (boots) the Copilot pane. Async; the pane is a nested iframe with its own SPA + auth, so it takes a beat. |
| `sendPromptToM365Copilot(text, { autoSubmit, gptId })` | app → agent | Places `text` in the Copilot input; `autoSubmit:true` submits it; `gptId` targets a specific declarative agent. |
| `addActionHandler(action, handler)` | agent → app | Registers a handler for a named action the agent/widget fans back to the host. |
| `getCurrentAgent()` | — | Returns the currently-open agent (incl. its id) — the reliable way to discover the real gptId. |

## Ambient typing (window.Xrm is not in PCF typings)

`window.Xrm` is not declared in `ComponentFramework` typings. Declare a minimal interface and read it
defensively — never assume it exists:

```ts
interface CopilotApi {
  isM365CopilotEnabled?: () => boolean;
  openM365CopilotPanel?: () => Promise<void> | void;
  sendPromptToM365Copilot?: (text: string, o?: { autoSubmit?: boolean; gptId?: string }) => Promise<void> | void;
  addActionHandler?: (action: string, handler: (data: unknown) => void) => void;
  getCurrentAgent?: () => unknown;
}
function copilotApi(): CopilotApi | undefined {
  return (window as unknown as { Xrm?: { Copilot?: CopilotApi } }).Xrm?.Copilot;
}
```

Then guard every call: `const c = copilotApi(); if (!c?.sendPromptToM365Copilot) { /* running outside the app */ }`.

## Sending a prompt to your agent (app → Copilot)

```ts
const c = copilotApi();
await c?.openM365CopilotPanel();                    // boot the pane FIRST
await c?.sendPromptToM365Copilot("Run the bridge smoke test", {
  autoSubmit: true,                                 // false = leave it editable in the input
  gptId,                                            // target YOUR declarative agent (see gptId below)
});
```

Give the user immediate feedback the instant the button is clicked — `openM365CopilotPanel()` has a
visible boot delay and otherwise looks like a dead button.

## Receiving an action back (Copilot → app)

The agent side cannot `postMessage` from a server tool — the fan-out is client-side in the MCP Apps
widget (see the **bidirectional-pcf-agent** skill). On the app side, register a handler — and because
the pane is a nested iframe where `addActionHandler` routing can be unreliable, **also** add a raw
`window` message listener (belt-and-suspenders):

```ts
copilotApi()?.addActionHandler?.("your.action.name", (data) => onAction(data));
window.addEventListener("message", (e) => {
  const d = e.data as { eventName?: string; action?: string; actionData?: unknown } | null;
  if (d?.eventName === "powerapps.copilot.chat.action" && d.action === "your.action.name") onAction(d.actionData);
});
```

## gptId — the #1 gotcha

The `gptId` you pass to `sendPromptToM365Copilot` is an **opaque M365 agent id**, NOT the ATK Teams app
GUID:
- Form: tenant-scoped **`T_<guid>`** or user-scoped **`U_<guid>.declarativeAgentPowerApps`**.
- For an ATK-provisioned declarative agent this is **`M365_TITLE_ID`** in the agent project's
  `env/.env.dev` — **not `TEAMS_APP_ID`**.
- The platform **re-mints it on agent republish**, so treat it as environment config, not a constant.
- **Verify the live value:** open the agent in the Copilot pane and run `Xrm.Copilot.getCurrentAgent()`
  in DevTools.

Wrong gptId fails **silently** — targeting falls back to the default Copilot experience instead of your
agent. Expose `agentId` as an editable PCF property (and, in this template, an editable field in the
smoke-test panel) so you can paste the verified id without a rebuild.

See also: **bidirectional-pcf-agent** (the full loop + constraints), **bridge-troubleshooting**
(symptom→cause when the loop is silent).
