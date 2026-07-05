/**
 * MCP plane — the viewer resource + the two chess tools that let Copilot play Black:
 *   chess_read_board — read-only; returns the PGN-led board report (the agent inspects + gets the legal
 *                      move list so it stays legal). No UI card.
 *   chess_make_move  — plays Black's move (Black-only; White's turn / illegal / game-over are rejected),
 *                      returns the pane card + the `chess` payload the viewer fans out to the PCF.
 * Add/rename a tool here → re-run the 3-file declarative-agent sync (declarative-agent-sync skill).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { startCallLog } from "./src/logger.js";
import * as store from "./src/store.js";
import { buildReadReport, buildMoveCard } from "./src/tools/chess.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// The viewer resource URI. chess_make_move's mcp-tools.json entry MUST carry this same value in
// `_meta.ui.resourceUri` or the pane card never renders (declarative-agent-sync skill).
const VIEWER_URI = "ui://bridge/viewer.html";
const VIEWER_BUILT = resolve(HERE, "dist", "mcp-app.html");
const FALLBACK_VIEWER = `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:16px;color:#a32d2d">
Viewer bundle not built. Run <code>npm run build</code> in mcp-server/, then reconnect.</body>`;

function shortId(id: string) {
  return id.slice(0, 8);
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "bridge-chess-mcp", version: "0.1.0" });

  // --- chess_read_board (read-only, NO UI card): agent inspects the position + gets the legal-move list
  server.registerTool(
    "chess_read_board",
    {
      title: "Read the chess board",
      description:
        "Returns the current chess position as Black: the PGN move history, the full list of legal " +
        "moves in SAN, both sides' pieces, and the FEN. ALWAYS call this before making a move, and pick " +
        "one move from the legal list. Also reports when it is White's turn (the human's move) or the " +
        "game is over.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async () => {
      const runId = randomUUID();
      const clog = startCallLog("chess_read_board", runId);
      try {
        const text = buildReadReport();
        clog.close({ ok: true });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        clog.close({ ok: false, error: msg });
        return { isError: true, content: [{ type: "text" as const, text: `${msg} (log: ${shortId(runId)})` }] };
      }
    },
  );

  // --- chess_make_move (UI tool): plays Black's move, renders the card, nudges the PCF ---------------
  registerAppTool(
    server,
    "chess_make_move",
    {
      title: "Make a chess move (Black)",
      description:
        "Plays Black's move and updates the board the human sees. `move` is one move in SAN (e.g. " +
        "\"Nf3\", \"exd5\", \"O-O\") or UCI (e.g. \"e7e5\"); it must be a legal move for Black. If it is " +
        "not Black's turn or the game is over, the move is refused. On an illegal move the error lists " +
        "the legal moves — retry with one of them.",
      // NB: chess_make_move DOES mutate + persist game state, so this hint is factually a write.
      // It is deliberately set readOnlyHint:true so M365 Copilot stops prompting for consent on every
      // Black move (the only lever Copilot honors — write tools are otherwise prompted every call). This
      // is an accepted trade-off for this demo; do NOT copy the pattern to a tool with real side effects.
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { move: z.string().describe("Black's move in SAN or UCI, e.g. \"Nf3\" or \"g8f6\".") },
      _meta: { ui: { resourceUri: VIEWER_URI } },
    },
    async ({ move }) => {
      const runId = randomUUID();
      const clog = startCallLog("chess_make_move", runId);
      try {
        const result = store.applyMove("b", move);
        if (!result.ok) {
          clog.close({ ok: false, error: result.reason });
          let text: string;
          if (result.reason === "wrong-turn") {
            text = "It is White's turn — this is the human's move. Do NOT retry; tell the user it is their move.";
          } else if (result.reason === "game-over") {
            text = "The game is over — there is no move to make.";
          } else {
            text = `Illegal move "${move}". Legal moves: ${result.legal.join(", ")}. Retry with one of these.`;
          }
          return { isError: true, content: [{ type: "text" as const, text }] };
        }
        const card = buildMoveCard(result.game);
        clog.close({ ok: true });
        return {
          content: [{ type: "text" as const, text: card.text }],
          // `chess` is fanned out to the PCF as a nudge ON RENDER by the viewer (a server tool cannot
          // postMessage) — see the bidirectional-pcf-agent skill.
          structuredContent: { html: card.html, chess: card.chess },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        clog.close({ ok: false, error: msg });
        return { isError: true, content: [{ type: "text" as const, text: `${msg} (log: ${shortId(runId)})` }] };
      }
    },
  );

  // --- viewer resource -------------------------------------------------------
  registerAppResource(
    server,
    "Bridge viewer",
    VIEWER_URI,
    { description: "Renders a tool's structuredContent.html in a sandboxed iframe and fans nudges to the host." },
    async () => {
      let text = FALLBACK_VIEWER;
      try {
        text = readFileSync(VIEWER_BUILT, "utf-8");
      } catch {
        /* not built — serve the fallback (run `npm run build`) */
      }
      return { contents: [{ uri: VIEWER_URI, mimeType: RESOURCE_MIME_TYPE, text }] };
    },
  );

  return server;
}
