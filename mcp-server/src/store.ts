/**
 * Singleton chess game — the authoritative source of truth for the whole demo, persisted to a JSON
 * file. The human plays White from the PCF (POST /move), Copilot plays Black via the chess_make_move
 * MCP tool; both funnel through applyMove(), which is the ONLY place the board mutates (single-writer
 * Node process → the two-caller race is a non-issue). chess.js does all legality/checkmate/draw work.
 *
 * Persistence stores the SAN history and replays it on load (NOT load(fen) — an FEN-only restore yields
 * an empty .pgn() and loses threefold-repetition tracking, both of which the read tool depends on).
 */
import { Chess } from "chess.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

export type Color = "w" | "b";
export type Status = "active" | "check" | "checkmate" | "stalemate" | "draw";

export interface GameSnapshot {
  fen: string; // full position: side-to-move, castling, en passant, clocks
  history: string[]; // SAN moves in order, for display / PGN
  humanColor: Color; // v1: always "w"
  turn: Color; // side to move (derived)
  status: Status; // derived from the position
  result: "1-0" | "0-1" | "1/2-1/2" | null; // set once the game ends
  lastMove: { san: string; from: string; to: string } | null;
  updatedAt: string; // ISO
}

/** A move for either side. String = SAN ("Nf3") or UCI ("e2e4"); object = board coordinates. */
export type MoveInput = string | { from: string; to: string; promotion?: string };

export type MoveResult =
  | { ok: true; game: GameSnapshot }
  // "wrong-turn" carries NO legal list on purpose: it must never hand a caller the opponent's moves to
  // "retry" with (that is the bug that let the agent play White — see the spec's C2). "illegal" carries
  // the current legal moves so the same-side caller can retry.
  | { ok: false; reason: "illegal" | "wrong-turn" | "game-over"; legal: string[] };

let chess = new Chess();
let humanColor: Color = "w";

// --- persistence ------------------------------------------------------------
interface Persisted {
  history: string[];
  humanColor: Color;
}

function load(): void {
  if (!existsSync(config.stateFile)) return;
  try {
    const parsed = JSON.parse(readFileSync(config.stateFile, "utf-8")) as Partial<Persisted>;
    const c = new Chess();
    for (const san of parsed.history ?? []) c.move(san); // replay → rebuilds full state + repetition
    chess = c;
    humanColor = parsed.humanColor === "b" ? "b" : "w";
  } catch {
    // Corrupt / unreplayable file — start a fresh game rather than crash.
    chess = new Chess();
    humanColor = "w";
  }
}
function save(): void {
  const dir = dirname(config.stateFile);
  if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
  const data: Persisted = { history: chess.history(), humanColor };
  writeFileSync(config.stateFile, JSON.stringify(data, null, 2));
}
load();

// --- derivation -------------------------------------------------------------
function statusOf(c: Chess): Status {
  if (c.isCheckmate()) return "checkmate";
  if (c.isStalemate()) return "stalemate";
  if (c.isDraw()) return "draw"; // 50-move / threefold / insufficient material
  if (c.isCheck()) return "check";
  return "active";
}
function resultOf(c: Chess): GameSnapshot["result"] {
  if (c.isCheckmate()) return c.turn() === "w" ? "0-1" : "1-0"; // side to move is the one mated
  if (c.isStalemate() || c.isDraw()) return "1/2-1/2";
  return null;
}
function snapshot(): GameSnapshot {
  const verbose = chess.history({ verbose: true });
  const last = verbose[verbose.length - 1];
  return {
    fen: chess.fen(),
    history: chess.history(),
    humanColor,
    turn: chess.turn(),
    status: statusOf(chess),
    result: resultOf(chess),
    lastMove: last ? { san: last.san, from: last.from, to: last.to } : null,
    updatedAt: new Date().toISOString(),
  };
}

// UCI like "e2e4" or "e7e8q" → coordinate object (auto-queen if no promo char given).
const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i;
function normalize(move: MoveInput): MoveInput {
  if (typeof move !== "string") {
    // Board coordinates: always auto-queen. chess.js ignores `promotion` on non-promotion moves.
    return { from: move.from, to: move.to, promotion: move.promotion ?? "q" };
  }
  const m = UCI.exec(move.trim());
  if (m) return { from: m[1].toLowerCase(), to: m[2].toLowerCase(), promotion: (m[3] ?? "q").toLowerCase() };
  return move.trim(); // SAN — pass through (explicit promotion like "e8=Q" is already encoded)
}

// --- public API -------------------------------------------------------------
export function newGame(): GameSnapshot {
  chess = new Chess();
  humanColor = "w";
  save();
  return snapshot();
}

export function getGame(): GameSnapshot {
  return snapshot();
}

/** Full SAN legal-move list for the side to move (read tool + POST /move error body). */
export function legalMovesSan(): string[] {
  return chess.moves();
}

/**
 * Apply a move for `expected` (the color the CALLER is allowed to move). Enforces turn ownership so the
 * human (White) can't move Black and the agent (Black) can't move White. chess.js v1 `.move()` THROWS on
 * an illegal move (0.x returned null) — hence the try/catch.
 */
export function applyMove(expected: Color, move: MoveInput): MoveResult {
  if (chess.isGameOver()) return { ok: false, reason: "game-over", legal: [] };
  if (chess.turn() !== expected) return { ok: false, reason: "wrong-turn", legal: [] };
  try {
    chess.move(normalize(move));
  } catch {
    return { ok: false, reason: "illegal", legal: chess.moves() };
  }
  save();
  return { ok: true, game: snapshot() };
}

/** 8×8 board array (rank 8 first), as chess.js .board() returns it — for the pane-card renderer. */
export function board(): ReturnType<Chess["board"]> {
  return chess.board();
}

/** Compact movetext for the read tool: "1. e4 e5 2. Nf3 Nc6 ...". */
export function movetext(): string {
  const h = chess.history();
  const parts: string[] = [];
  for (let i = 0; i < h.length; i += 2) {
    const n = i / 2 + 1;
    parts.push(`${n}. ${h[i]}${h[i + 1] ? " " + h[i + 1] : ""}`);
  }
  return parts.join(" ");
}
