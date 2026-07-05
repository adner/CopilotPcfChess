---
name: mcp-apps-tool-dev
description: >
  Add or modify a tool on the template's MCP (Apps) server — the core loop of every new demo built
  from this template. Use when the user says "add an MCP tool", "add a tool to the server", "make the
  agent able to do X", "return a UI/card/chart from a tool", "wire up a new server capability", or when
  you are editing server.ts / src/tools/*. Covers the registerAppTool pattern, structuredContent, the
  viewer-resource decision, per-call logging, the vanilla-only widget constraint, inline-vs-fetch
  rendering, and the probe-first inner loop. After changing a tool, ALWAYS follow with declarative-agent-sync.
---

# Adding & modifying MCP tools on the template server

This server exposes two planes off one Express app (`main.ts`): the **MCP plane** (`POST /mcp`) that the
Copilot pane drives, and the **web plane** (`web.ts`) that the PCF/served components hit over plain HTTP.
Tools live in `server.ts` and `src/tools/`. `example-tool.stub.ts` is a copy-paste starting point.

## The registerAppTool pattern

Use `registerAppTool` for a **UI tool** (renders in the Copilot pane via the viewer resource); use the
plain SDK `server.registerTool` for a **text-only tool**.

```ts
registerAppTool(
  server,
  "my_tool",
  {
    title: "My Tool",
    description: "One clear sentence the model uses to decide WHEN to call this. Be specific.",
    // readOnlyHint:true = doesn't mutate external systems (host won't prompt for approval).
    // openWorldHint:true = calls out to a network/LLM/Dataverse; false = self-contained.
    annotations: { readOnlyHint: true, openWorldHint: false },
    // inputSchema is a RAW zod shape — a plain object of validators, NOT z.object({...}).
    inputSchema: {
      thing: z.string().min(1).describe("What this argument is, for the model."),
    },
    // ONLY for UI tools — links the tool to the viewer that renders its structuredContent.html.
    _meta: { ui: { resourceUri: VIEWER_URI } },
  },
  async ({ thing }: { thing: string }) => {
    const runId = randomUUID();
    const clog = startCallLog("my_tool", runId);
    clog.log("info", "input", { thing });
    try {
      // ...do work...
      const html = assembleDocument(renderCore, { mode: "inline", rows }, { title });
      clog.close({ ok: true });
      return {
        content: [{ type: "text" as const, text: `Did the thing with ${thing}.` }],
        structuredContent: { title, html /*, any machine payload the viewer reads */ },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      clog.close({ ok: false, error: msg });
      return { isError: true, content: [{ type: "text" as const, text: `${msg} (log: ${shortId(runId)})` }] };
    }
  },
);
```

**`content` vs `structuredContent`.** `content` is the model/chat-visible text. `structuredContent` is the
machine payload the viewer (`mcp-app.ts`) reads — for a UI tool this MUST carry `html` (the assembled
document) plus anything the viewer needs (e.g. the smoke-test tool also returns `smoke: { message, ts }`
so the viewer can fan the nudge out to the PCF). On failure return `{ isError:true, content:[text] }`.

**UI vs text-only.** Give a tool the viewer resource (`_meta.ui.resourceUri`) only when it should render
something in the pane. A tool that just reports a fact returns text and no `_meta`. If you register a UI
tool, you MUST also add `_meta.ui.resourceUri` to its entry in the agent's `mcp-tools.json`
(declarative-agent-sync) — forget it and the pane card silently never renders.

## Logging & error handling (do this in every tool)

`src/logger.ts` gives per-call structured logs. Always: `const runId = randomUUID()` →
`const clog = startCallLog("<tool>", runId)` → `clog.log("info", event, data)` for progress →
`clog.close({ ok })` on both success and failure. The catch block appends a user-facing
**`(log: <8-char runId>)`** handle (via `shortId(runId)`) so a failure in Copilot can be traced to its
`logs/<ts>_<tool>_<runId8>.jsonl` file. Never log raw secrets — `redact()` scrubs secret-like keys; use a
redacted config summary, never dump `.env`.

## Rendering is vanilla-only — and WHY

Widget/card code that runs inside the pane or a served component iframe must be **self-contained vanilla
JS/HTML/SVG**: NO CDNs, NO external stylesheets/fonts, NO `fetch`/`eval`/`new Function`/`import` inside the
widget. The reason is **host CSP variance** — the Copilot pane and Power Apps apply their own Content
Security Policy, and anything reaching for an external origin (or eval) is silently blocked in one host or
another. Embed images/assets as `data:` URIs. Keep charts hand-rolled SVG. This immunity to CSP variance
is the whole point; don't trade it for a charting library.

## Generate once, wrap twice (inline vs fetch)

`assembleDocument(renderCore, dataSource, { title })` wraps a plain `function render(container, rows){…}`
into a self-contained HTML document in one of two modes:

- **`inline`** — rows baked in; returned as `structuredContent.html` for the **Copilot pane** widget.
- **`fetch`** — the doc fetches `/<component>/data?k=…` on load and on refresh; used for a **served
  component** (e.g. a PCF tile) so it shows live data.

One `render()` serves both. The doc also bundles a small bridge (`widget-resize` height out, `set-theme`
in) so the widget reflows and themes correctly. When you add a new visual, check it against the
vanilla-only rule above before wiring it in.

## Probe-first inner loop — never debug in a host

The fastest loop is **host-free**. `npm run probe` exercises a tool's logic directly and prints what it
would return (the assembled `html`, the nudge payload, etc.) — no MCP client, no Copilot, no Power Apps.
Get the tool correct under `probe`, THEN connect a host. Debugging a new tool by clicking through Copilot
is the slow path; reach for it only after `probe` is green.

## Repo conventions that will bite you

- **ESM throughout** (`"type":"module"`). Relative imports use **`.js` extensions even from `.ts`
  sources** (`import { x } from "./store.js"`). Omit it and the build/runtime fails.
- **Two tsconfigs**: `tsconfig.server.json` (Node; excludes the DOM viewer) and `tsconfig.json` (DOM; for
  `src/mcp-app.ts`). `npm run typecheck` runs both — run it after edits.
- **`npm run build` BEFORE `npm run serve`.** The viewer is a Vite single-file bundle → `dist/mcp-app.html`.
  Serve without building and the viewer resource returns a "not built" fallback page. `npm run dev` watches
  both.

## Going deeper

For MCP Apps SDK internals (resource registration, app lifecycle, host integration) beyond this template's
conventions, use the `mcp-apps:create-mcp-app` and `mcp-apps:add-app-to-server` plugin skills. This skill
covers *this template's* tool-authoring workflow; those cover the SDK in general.
