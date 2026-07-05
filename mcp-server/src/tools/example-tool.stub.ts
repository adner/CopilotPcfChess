/**
 * EXAMPLE STUB — copy this shape to add a real tool. NOT registered by default. Wire it into
 * createServer() in ../../server.ts (call `registerExampleTool(server)`), then re-run the 3-file
 * declarative-agent sync so Copilot can actually call it (see the declarative-agent-sync skill).
 *
 * Two flavours:
 *   • UI tool  — `registerAppTool(...)` with `_meta.ui.resourceUri`; returns `structuredContent.html`
 *                that the viewer renders (and, for the bridge, can nudge from). Shown below.
 *   • text tool — plain `server.registerTool(...)`; no `_meta.ui`; returns only `content` text.
 * Always keep the per-call log + `(log: <id>)` error handle (see mcp-apps-tool-dev).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { startCallLog } from "../logger.js";

const VIEWER_URI = "ui://bridge/viewer.html";
const shortId = (id: string) => id.slice(0, 8);

export function registerExampleTool(server: McpServer): void {
  registerAppTool(
    server,
    "example_tool",
    {
      title: "Example tool",
      description: "Replace me: say what this tool does and WHEN Copilot should call it (be specific).",
      // readOnlyHint/openWorldHint tune the host approval prompt; openWorldHint:true if you call out
      // to a network service (OpenAI, an API, Dataverse via MCP).
      annotations: { readOnlyHint: true, openWorldHint: false },
      // zod RAW shape (a plain object of validators — NOT z.object(...)).
      inputSchema: { text: z.string().min(1).describe("An input parameter.") },
      _meta: { ui: { resourceUri: VIEWER_URI } }, // omit entirely for a text-only tool
    },
    async ({ text }: { text: string }) => {
      const runId = randomUUID();
      const clog = startCallLog("example_tool", runId);
      try {
        // ...do the work here; for a UI tool build `html` via assembleDocument(...) ...
        clog.close({ ok: true });
        return {
          content: [{ type: "text" as const, text: `example_tool received: ${text}` }],
          // The viewer reads structuredContent — put the `html` (and any payload to nudge) here.
          structuredContent: { echo: text },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        clog.close({ ok: false, error: msg });
        return { isError: true, content: [{ type: "text" as const, text: `${msg} (log: ${shortId(runId)})` }] };
      }
    },
  );
}
