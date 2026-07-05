/**
 * Plain-HTTPS web plane — what the PCF hits over HTTP. All routes are capability-token gated (?k=).
 *   GET  /game?k=      -> { game }                 the authoritative board (PCF load + on every nudge)
 *   POST /move?k=      -> { game } | 409 {reason,legal}   the human's (White) move
 *   POST /new-game?k=  -> { game }                 reset to the start position
 * The human plays White, so POST /move enforces `expected="w"` in the store (a Black move here is a
 * wrong-turn 409). Copilot's Black moves come in over the MCP plane via the chess_make_move tool.
 */
import { Router, type Request, type Response } from "express";
import { config } from "./config.js";
import { tokenOk } from "./security.js";
import { httpLog } from "./logger.js";
import * as store from "./store.js";

function done(req: Request, status: number, start: number, tokenOkFlag?: boolean) {
  httpLog({
    method: req.method,
    path: req.path,
    status,
    ms: Date.now() - start,
    tokenOk: tokenOkFlag,
    origin: req.header("origin"),
  });
}

export function webRouter(): Router {
  const r = Router();

  // Authoritative board — the PCF reads this on load and after every nudge (reconcile-via-server).
  r.get("/game", (req: Request, res: Response) => {
    const start = Date.now();
    if (!tokenOk(req.query.k, config.stateKey)) {
      done(req, 401, start, false);
      return res.status(401).json({ error: "invalid token" });
    }
    res.setHeader("Cache-Control", "no-store");
    done(req, 200, start, true);
    res.json({ game: store.getGame() });
  });

  // The human's (White) move. Body: { from, to } (auto-queen server-side).
  r.post("/move", (req: Request, res: Response) => {
    const start = Date.now();
    if (!tokenOk(req.query.k, config.stateKey)) {
      done(req, 401, start, false);
      return res.status(401).json({ error: "invalid token" });
    }
    const body = (req.body ?? {}) as { from?: unknown; to?: unknown };
    if (typeof body.from !== "string" || typeof body.to !== "string") {
      done(req, 400, start, true);
      return res.status(400).json({ error: "expected { from, to }" });
    }
    const result = store.applyMove("w", { from: body.from, to: body.to });
    res.setHeader("Cache-Control", "no-store");
    if (!result.ok) {
      done(req, 409, start, true);
      return res.status(409).json({ reason: result.reason, legal: result.legal });
    }
    done(req, 200, start, true);
    res.json({ game: result.game });
  });

  // Reset the game to the start position.
  r.post("/new-game", (req: Request, res: Response) => {
    const start = Date.now();
    if (!tokenOk(req.query.k, config.stateKey)) {
      done(req, 401, start, false);
      return res.status(401).json({ error: "invalid token" });
    }
    res.setHeader("Cache-Control", "no-store");
    done(req, 200, start, true);
    res.json({ game: store.newGame() });
  });

  return r;
}
