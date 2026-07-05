# CopilotPcfChess — Specification

**Play chess against M365 Copilot.** A model-driven Power Apps **PCF** renders an interactive chess
board; the human plays **White**. Each human move is written to the **MCP/web server** (the authoritative
game state) and auto-forwarded to a **declarative Copilot agent**, which reasons out **Black's** reply,
plays it through an MCP tool, and the move **nudges** back to the PCF. It is a concrete implementation of
the bidirectional `Xrm.Copilot ↔ MCP` bridge described in the template.

> This supersedes the one-paragraph brief. It reflects the decisions made during the design interview
> (see **§10 Decisions**). Anything marked *(v2)* is explicitly out of scope for the first build.

---

## 1. Core decisions (the spine)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Opponent's brain | **Copilot reasons its own moves.** The server enforces legality: it hands the agent the legal-move list and **rejects** illegal moves so the agent retries. No embedded engine. |
| 2 | Human input | **Interactive board** — click a piece, then click a legal target (drag optional later). Legal targets highlighted. |
| 3 | Rules & legality | **`chess.js`** is the single source of truth on the **server**; also bundled in the **PCF** for instant highlighting + optimistic UI. Server always re-validates. |
| 4 | Turn trigger | After the human's move the PCF **auto-opens the Copilot pane and submits a "your move" prompt**. |
| 5 | Sides | Human is **White and moves first**; Copilot is **Black**. |
| 6 | Promotion | **Auto-queen** (v1). Promotion picker is *(v2)*. |
| 7 | Controls | **New game / reset** and **Ask Copilot for a hint**. Resign / undo are *(v2)*. |
| 8 | Copilot pane card | The viewer renders a **mini board + move text** for Copilot's move. |
| 9 | Game scope | **One global game**, keyed by `STATE_KEY`, persisted in `store.ts`. |

---

## 2. Architecture — how it maps onto the template

Three planes, unchanged in shape from the smoke-test loop; only the payloads change.

```
                    ┌──────────────────── PCF (Bridge.SmokeTestPanel) ────────────────────────┐
   human clicks →   │  interactive board (chess.js for highlight)                              │
                    │    │ 1. POST /move {from,to}          4. on nudge → GET /game → re-render │
                    └────┼───────────────────────────────────────────────▲─────────────────────┘
                         │ (web plane, token-gated)                       │ nudge (host message)
                         ▼                                                │
              ┌───────── MCP / web server ───────────┐                    │
              │  store.ts  = chess.js game (FEN,      │                    │
              │             history, status) + JSON   │                    │
              │  web.ts    : POST /move, POST /new-game, GET /game          │
              │  server.ts : tools chess_read_board, chess_make_move        │
              └───────▲───────────────────────────────┘                    │
                      │ 3. chess_make_move (Black's move)      2. sendPromptToM365Copilot("your move")
                      │    → validate → apply → return {html, chess}        │
              ┌───────┴──────────── declarative agent ─────────────────────┴──┐
              │  reads board (chess_read_board) → picks a LEGAL move →         │
              │  chess_make_move → viewer renders mini-board card AND          │
              │  fans the `chess` payload out to the PCF as a nudge            │
              └───────────────────────────────────────────────────────────────┘
```

**The move loop, end to end**

1. **Human moves.** Board click→click produces `{from,to}` (UCI squares, e.g. `e2`→`e4`). The PCF
   optimistically validates with its local `chess.js`, then `POST /move`. Server re-validates with the
   authoritative `chess.js`, applies, persists, returns the new game snapshot. PCF renders it.
2. **Hand-off.** PCF calls `openM365CopilotPanel()` then
   `sendPromptToM365Copilot("I played <SAN>. Your move.", { autoSubmit:true, gptId })`.
3. **Copilot replies.** Agent calls **`chess_read_board`** (gets FEN, side-to-move, **legal moves in
   SAN**, last move, status), chooses a legal move, calls **`chess_make_move`**.
4. **Nudge back.** `chess_make_move` validates + applies + persists, returns `{ html, chess }`. The
   viewer renders the mini-board card **and fans `chess` out to the PCF as a nudge**.
5. **PCF refreshes.** On the nudge the PCF calls **`GET /game`** (reconcile-via-server — never trust the
   nudge payload as truth) and re-renders. It is the human's turn again.
6. **Game over.** When the server detects checkmate / stalemate / draw, `status`+`result` flip; both the
   pane card and the PCF show the outcome and disable play until **New game**.

**Illegal Copilot move.** `chess_make_move` returns `isError` with the reason **and the legal-move
list**; the agent's instructions tell it to retry with a legal move. The server never applies an
illegal move, so the game cannot corrupt.

---

## 3. Server — shared game state (`mcp-server/src/store.ts`, rewrite)

Replace the smoke-test `State` with a chess game. Keep an in-memory `chess.js` instance as the source of
truth; persist a compact snapshot to the JSON state file so a restart resumes the game.

```ts
import { Chess } from "chess.js";

export interface GameSnapshot {
  fen: string;                 // full position (side-to-move, castling, en passant, clocks)
  history: string[];           // SAN moves in order, for display
  humanColor: "w";             // v1: always white
  turn: "w" | "b";             // derived from fen
  status: "active" | "check" | "checkmate" | "stalemate" | "draw";
  result: "1-0" | "0-1" | "1/2-1/2" | null;
  lastMove: { san: string; from: string; to: string } | null;
  updatedAt: string;           // ISO
}
```

- `newGame(): GameSnapshot` — reset to the start position, `humanColor:"w"`, persist.
- `getGame(): GameSnapshot` — current snapshot (derive `turn`/`status`/`result` from the instance).
- `applyMove(move): { ok: true; game } | { ok: false; reason: "illegal" | "wrong-turn"; legal: string[] }`
  — accepts a move for **the side to move only**. Input is a single string (SAN `"Nf3"` or UCI `"e2e4"`);
  auto-queens promotions server-side. Failure modes are **distinct** (this matters — see C2 / §5 / §7):
  - `reason:"wrong-turn"` when the move is for the side *not* to move → return with **no legal list**
    (an empty `legal:[]`) so the agent is never handed the opponent's moves to "retry" with.
  - `reason:"illegal"` when it's the right side but the move is illegal → return the current
    **legal moves in SAN** so the caller can retry.
  On success, persist and return the new snapshot.
  **chess.js v1 gotcha:** `.move()` **throws** on an illegal move (0.x returned `null`) — wrap in
  try/catch and map the throw to `reason:"illegal"`.
- `legalMovesSan(): string[]` — the full SAN legal-move list (read tool + `POST /move` error body). The
  PCF computes its own click-highlight targets from its local `chess.js`, so no per-square helper is
  exposed here.

Persistence mirrors today's `load()/save()`: on load, `new Chess()` then **replay `history`** (never
`load(fen)` alone — an FEN-only restore yields an empty `.pgn()` and loses threefold-repetition
tracking, both of which §5's read format depends on). Keep `fen` only as a post-replay integrity check.
On corrupt file, start a fresh game rather than crash.

**Pin the same `chess.js` version** in `mcp-server/package.json` and `pcf-control/package.json` so
server-side SAN generation and PCF-side highlighting can't drift.

---

## 4. Server — web plane (`mcp-server/src/web.ts`)

All three are **token-gated by `STATE_KEY`** (reuse `tokenOk`). Mutating routes are `POST`.

| Route | Body / query | Returns | Who calls it |
|-------|--------------|---------|--------------|
| `GET /game?k=` | — | `{ game: GameSnapshot }` | PCF: initial load + on every nudge |
| `POST /move?k=` | `{ from, to }` (auto-queen) | `{ game }` on 200, or `{ reason, legal }` on 409 | PCF: the human's move |
| `POST /new-game?k=` | — | `{ game }` | PCF: New game button |

Notes:
- **Drop `GET /state`** — nothing depends on it once the PCF is replaced, and its response shape
  (`{state}`) differs from `{game}`, so an "alias" would just be a second shape to maintain. **Bump
  nothing else in the coupling** (`PUBLIC_BASE_URL` / `serverBaseUrl` / manifest `<domain>` stay as-is).
- `POST /move` returning **409 + `{reason, legal}`** lets the PCF surface "illegal / not your turn"
  cleanly even though its optimistic `chess.js` should prevent it.
- `express.json()` is already mounted in `main.ts`; CORS already allows POST — add nothing there.

---

## 5. Server — MCP tools (`mcp-server/server.ts`)

Two tools replace `smoke_test`. Both go through the **3-file declarative-agent sync** (§7).

### `chess_read_board` (plain tool, read-only)
- **Input:** none.
- **Returns** `content:[{type:"text"}]` — a text report **ordered to play to an LLM's training
  distribution** (see the format rationale below). No UI card needed.
  `annotations:{ readOnlyHint:true, openWorldHint:false }`.
- **Purpose:** the agent inspects the position and, crucially, gets the **legal-move list** so it stays
  legal.

**Report format** (this exact ordering — leads with PGN, ends with FEN, **no ASCII board**):

```
It is Black to move (move 12).
PGN: 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 ...            ← full SAN move history from the start
Legal moves (SAN): Nf6, d6, Be7, O-O, ...          ← the whole list; the agent MUST pick from it
Black pieces: Ke8, Qd8, Rf8, Nc6, pawns b7 c7 ...  ← explicit piece placement, both colors
White pieces: Ke1, Qd1, ...
FEN: r1bqk2r/pppp1ppp/... b KQkq - 0 12            ← compact canonical anchor (don't rely on the
                                                      model reasoning off it)
Flags: check=false, castling=KQkq, ep=-, status=active
```

**Two special leading lines** the read tool must emit instead of "It is Black to move":
- **Game over** → `Game over: 1-0 (checkmate). No move to make.` (or the relevant result/reason). The
  agent must not attempt a move.
- **White to move** (the poll already applied Black's… no — this means it's the *human's* turn; a
  duplicate/late "your move" prompt) → `It is White's turn — it is the human's move, not yours. Do not
  move; tell the user it's their turn.`

**Why this order (not FEN- or ASCII-first):** LLMs play markedly better *continuing a PGN transcript*
(in-distribution) than reasoning off a board diagram; FEN's run-length empty-square encoding forces
error-prone counting; and a monospace ASCII grid mis-tokenizes (visual column alignment ≠ token
alignment), so it can mislead more than it helps. Leading with **PGN move history**, then the
**legal-move list**, then an **explicit piece list** (reliably parsed spatial anchor), with **FEN last**
and metadata, is the most robust for move *quality*. Legality is already guaranteed by the server's
reject-and-retry loop regardless of representation. `chess.js` gives PGN via `.pgn()`, piece placement
via `.board()`, and FEN via `.fen()`. (`.ascii()` is deliberately **not** used.)

### `chess_make_move` (UI tool → renders the pane card + nudges)
- **Input schema:** a **single required `move: string`** — SAN (`"Nf3"`, `"exd5"`, `"O-O"`) or UCI
  (`"e2e4"`); parsed server-side. (One flat field, not a `{move} | {from,to}` union — draft-07 `oneOf`
  unions render poorly in Copilot's tool enumeration and would have to be kept in sync across
  `server.ts` and `mcp-tools.json`.)
- **Black-only enforcement (the C2 fix):** this tool plays **Black only**. Route through
  `store.applyMove`, then:
  - `reason:"wrong-turn"` → `isError:true`, text: *"It is White's turn — this is the human's move. Do
    NOT retry; tell the user it's their move."* **No legal list** (so the agent can't "retry" with a
    White move).
  - `reason:"illegal"` → `isError:true`, text: the reason **plus the legal-move list**, so the agent
    retries with a legal Black move.
  - Game already over → `isError:true`, text: *"Game over (<result>) — no move to make."*
  On success return:
  ```ts
  {
    content: [{ type: "text", text: "Black played Nf3. <status line>" }],
    structuredContent: {
      html: renderBoardCard(snapshot),   // mini board + move text (assemble-document, inline mode)
      chess: { fen, san, from, to, status, result }  // fanned out to the PCF as a nudge
    }
  }
  ```
- `annotations:{ readOnlyHint:false, openWorldHint:false }`. Carries `_meta.ui.resourceUri` = the viewer
  URI (unchanged: `ui://bridge/viewer.html`). **Mirror both `_meta` key forms** the existing
  `mcp-tools.json` uses (`ui.resourceUri` **and** `ui/resourceUri`) — see §7.

**Board card renderer** (`mcp-server/src/tools/chess.ts`): a vanilla `render(container, rows)` core that
draws an 8×8 board using the **shared inline-SVG piece set** (§8.1) on `var(--panel)`/`var(--border)`
squares, with a caption line "Black played **Nf3** — your move."

- **Pass a pre-computed board, not a FEN, to the core.** The render core is a string of vanilla JS with
  no imports; parsing FEN placement inside it is the fiddliest, most bug-prone part. Instead the server
  computes `chess.js` `.board()` (a 64-cell array) and passes it as `rows[0].board`; the core just maps
  cells → squares + piece SVGs. Keep `fen`/`san`/`status` in the row too. So:
  `assembleDocument(core, {mode:"inline", rows:[{board, fen, san, status}]}, {title:"Copilot's move"})`.
- **The core must call `window.__measure()` after painting** (as `smoke-test.ts` does) or the pane card
  stays pinned at the viewer's 220px default and mis-sizes.
- Static render — **no fetch**. Pieces inlined as `data:` URIs / inline `<svg>`, the **only** thing the
  inner CSP allows (`img-src data:` — external image URLs, PNG or SVG, are blocked). This static card is
  **not** routed through `sanitizeRenderCore` (that guard is for LLM-generated cores); no need to satisfy
  it, though the piece `data:` URIs + SVG `xmlns` would pass anyway.

---

## 6. Server — viewer fan-out (`mcp-server/src/mcp-app.ts`)

Generalize the smoke-test fan-out to the chess payload. Change the two constants and the `ontoolresult`
branch:

```ts
const HOST_EVENT  = "powerapps.copilot.chat.action";   // unchanged host channel
const HOST_ACTION = "template.chess.moved";            // was template.smoketest.ping

// in ontoolresult, after renderContent(sc.html):
if (sc.chess) fanoutNudge(sc.chess);   // actionData = { fen, san, from, to, status, result }
```

`fanoutNudge` keeps its multi-frame `postMessage` belt-and-suspenders. **This envelope MUST match the
PCF** (see §8, and the CLAUDE.md "critical coupling" rule).

---

## 7. Declarative agent (`declarative-agent/ExperimentAgent/`, via `declarative-agent-sync` skill)

**This is an UPDATE, not a scaffold.** `declarative-agent/ExperimentAgent/` already exists (ATK-scaffolded,
gitignored) with `appPackage/{mcp-tools.json, ai-plugin.json, instruction.txt}` currently wired to
`smoke_test` and pointed at the devtunnel `/mcp`. The job is to swap the tool set and rewrite the
instructions, then re-provision. (CLAUDE.md still says "declarative-agent/ — empty" and "agentId not yet
set" — **both stale**; reconcile at §9-7.)

- **`instruction.txt`** — the system prompt. Must establish:
  - "You are playing chess as **Black** against a human (White). The board lives in a Power Apps PCF; the
    server is the source of truth."
  - On a "your move" / "your turn" prompt: **always call `chess_read_board` first**. If the report says
    **White to move** (the human's turn — a duplicate/late prompt) → reply in chat that it's their move,
    **do not** call `chess_make_move`. If it says **game over** → announce the result, do not move.
    Otherwise choose **one legal move from the provided list** and call **`chess_make_move`**. Never
    invent a move not in the list.
  - If `chess_make_move` returns an **illegal-move** error, read the legal list in the error and retry
    with a legal move — but **at most 3 times**; after that, explain in chat rather than looping (tool
    budgets are finite).
  - If `chess_make_move` returns a **"not your turn / White's move"** error, **do not retry** — tell the
    user it's their move. (It will carry no legal list.)
  - **Hint mode:** if the human asks for a hint/suggestion (see §8 Hint), call `chess_read_board` and
    **suggest** a move for *White* in chat **without** calling `chess_make_move`.
  - Announce moves in SAN and keep commentary short.
- **3-file tool-enumeration sync** (fails *silently* when it drifts): **remove `smoke_test`** and register
  `chess_read_board` + `chess_make_move` in both `mcp-tools.json` (tool schemas) **and** `ai-plugin.json`
  (`functions` + `run_for_functions`). Give `chess_make_move` `_meta.ui.resourceUri:
  "ui://bridge/viewer.html"` — the existing file carries this in **both** key forms (`ui.resourceUri`
  *and* `ui/resourceUri`); mirror both. Run the `declarative-agent-sync` skill after the swap.
- After re-provisioning, set the agent's **gptId** (`M365_TITLE_ID`, `T_<guid>`) on the PCF `agentId`
  bind prop and record it in CLAUDE.md.

---

## 8. PCF — `Bridge.SmokeTestPanel` (`pcf-control/`, internals replaced with the chess board)

A full-page dataset control (dataset only hosts it; records ignored — same as today).

**Keep the control name — rewrite only the internals.** We deliberately **keep** the constructor
`SmokeTestPanel` (folder, `.pcfproj`, `<code>` class, `css/SmokeTestPanel.css`, control full name
`bridge_Bridge.SmokeTestPanel`) and just replace what `index.ts` does. Renaming to `ChessBoard` would
mint a *new* control identity and force a grid **re-bind** (the `CustomControlDefaultConfigs` in
`CmpTemp0` names the control by full name — `bind-grid.mjs:114`) plus leave an orphaned old control.
Keeping the name means the existing binding still resolves, so **no re-bind** — only the usual
version-bump + `pac pcf push` + publish. (The demo-facing name stays `SmokeTestPanel`; cosmetic only.)

**Manifest** (`ControlManifest.Input.xml`): keep the four bind props (`serverBaseUrl`, `agentId`,
`stateKey`, `autoRefreshSeconds`) and `<external-service-usage>` `<domain>` = the devtunnel; bump
`version` every push (pcf-develop-deploy rule). Optionally refresh `display-name-key`/`description-key`
to chess wording (safe — display strings, not identity).

**Dependencies:** `npm i chess.js` in `pcf-control/` (same pinned version as the server — §3).

### 8.1 Chess piece assets (shared with the pane card)

- Use a proper **SVG piece set** — the standard **"Cburnett"** pieces (as on Wikipedia/Lichess), **not**
  Unicode glyphs (outline-only "white" pieces vanish on light squares and render differently per
  OS/font) and **not** PNG (raster pixelates on a resizable full-page board).
- **Inlined as `data:` URIs / inline `<svg>`, never linked.** This is mandatory, not a preference: the
  pane-card viewer's inner CSP is `img-src data:`, so any external image URL is blocked there — and
  inlining also removes CORS/PCF-resource-loading fuss on the PCF side. One embedded set therefore
  serves **both** surfaces.
- Store the 12 piece SVGs as a single `piece → svg/data-URI` map. The PCF (`pieces.ts`) and the server
  card renderer (`src/tools/chess.ts`) each hold a copy (the server can't import from the PCF); it's
  static data, so duplication is fine. Board squares stay CSS (`var(--panel)`/`var(--border)`), pieces
  are the SVGs on top.
- **Licensing:** Cburnett is CC BY-SA 3.0 / GFDL / BSD — fine for this private demo. If zero-attribution
  is preferred, substitute a CC0 set (several Lichess sets are public domain).

**UI:**
- 8×8 board with the §8.1 SVG pieces, coordinate labels. **Click-to-move:** click own piece → legal
  targets highlight (from local `chess.js`) → click a target to move; click elsewhere to deselect.
- Status line: whose turn, check/checkmate/draw, last move (SAN), move list (optional scroll).
- Buttons: **New game**, **Ask Copilot for a hint**. (No resign/undo in v1.)
- Board is **interaction-locked whenever `turn !== humanColor`** or the game is over. Note `status:"check"`
  is **still playable** — only `checkmate | stalemate | draw` is game-over.

**Behavior:**
- **Init / New game:** `GET /game` (or `POST /new-game`) → render. Keep a local `Chess` mirror in sync
  from the returned FEN for highlighting.
- **Human move:** optimistic local apply → `POST /move {from,to}` → on 200 re-sync from server → then
  **auto-hand-off**: `openM365CopilotPanel()` + `sendPromptToM365Copilot("I played <SAN>. Your move.",
  { autoSubmit:true, gptId })`. **Roll back the optimistic move on *any* failure** (409 *and* network
  error — a down tunnel must not leave a move the server never saw); show the error.
- **Hand-off failure:** if `openM365CopilotPanel()` / `sendPrompt…` throws, the move is **already
  committed server-side** — show "Couldn't open Copilot; open the pane and say 'your move'." Do **not**
  roll the board back.
- **`agentId` unset:** if the `agentId` bind prop is empty, `sendPrompt…` would hit mainline Copilot,
  which has no chess tools — surface a status error instead of silently prompting nothing useful.
- **Nudge receive:** DUAL registration (raw `window` `message` + `addActionHandler`) for
  `eventName:"powerapps.copilot.chat.action"`, `action:"template.chess.moved"` → on receipt **`GET
  /game`** and re-render (reconcile-via-server; ignore `actionData` as truth, use only as a wake signal).
- **Re-render is change-detected:** only repaint when the fetched `fen`/`updatedAt` differs from the
  local mirror. An unconditional repaint on every poll/nudge wipes a mid-click selection and flickers.
- **Hint:** `openM365CopilotPanel()` + `sendPromptToM365Copilot("Suggest a good move for me — don't play
  it.", { autoSubmit:true, gptId })`. The agent answers in chat only.
- **Auto-refresh:** keep the `autoRefreshSeconds` poll of `GET /game` as a backstop if a nudge is missed
  (accepted latency up to one poll interval when the pane is closed or the host lacks Apps support, so no
  card renders and no nudge fires).

**Shared constants (must match the server exactly):**
```ts
const HOST_EVENT  = "powerapps.copilot.chat.action";
const HOST_ACTION = "template.chess.moved";
```

---

## 9. Implementation plan (suggested order)

> **`smoke_test` must be removed as a unit, or the build breaks at step 1.** `store.ts`'s current
> `recordPing`/`State` (deleted in step 1) are imported by `src/tools/smoke-test.ts`, registered in
> `server.ts`, driven by `probe.ts`, and typed in `mcp-app.ts` (`smoke` payload). So steps 1 and 3
> together delete `src/tools/smoke-test.ts`, deregister the tool in `server.ts`, convert `probe.ts`, and
> retype the viewer — `typecheck` goes green again at step 4. (Do the server side in one commit to
> minimise the red window.)

1. **Server state** — add + pin `chess.js`; rewrite `store.ts` to the chess game (§3, incl. distinct
   `illegal`/`wrong-turn` failure + history-replay persistence). **Delete `src/tools/smoke-test.ts`** and
   convert `probe.ts` into a `chess` probe (drive `newGame`/`applyMove`, print the read-tool report +
   assert legality rejection).
2. **Web plane** — `GET /game`, `POST /move`, `POST /new-game`; **remove `GET /state`** (§4).
3. **Tools + card** — `chess_read_board`, `chess_make_move` (single `move:string`, Black-only, §5),
   `renderBoardCard` (pre-computed `.board()` array, `__measure`); **deregister `smoke_test`** and wire
   the two chess tools in `server.ts`.
4. **Viewer** — retype/replace the `smoke` fan-out with `chess` / `template.chess.moved` (§6); **then**
   `npm run build` the viewer and confirm `npm run typecheck` (both tsconfigs) is green.
5. **PCF** — keep the `SmokeTestPanel` name; replace `index.ts` internals with the board UI + loop (§8);
   `npm run build`; push (bump version); publish. **No re-bind** — the existing grid binding still
   resolves.
6. **Agent (update, not scaffold)** — in `declarative-agent/ExperimentAgent/`: swap `smoke_test` → the
   two chess tools in `mcp-tools.json` **and** `ai-plugin.json`, rewrite `instruction.txt` (§7), run
   `declarative-agent-sync`, re-provision; set `gptId`.
7. **End-to-end** — play a full game; verify illegal-move retry, wrong-turn no-retry, and game-over
   paths; **reconcile CLAUDE.md** (declarative-agent no longer empty, tools list, gptId, nudge envelope,
   the "Fill in as your demo grows" block).

**Verification** (no test runner): server-side `probe` for `applyMove`/legality; the manual play loop
for the bridge. `npm run typecheck` (both tsconfigs) must be green by end of step 4 and stay green.

---

## 10. Decisions (from the design interview)

Opponent = **Copilot reasons its own moves** (server enforces legality) · Input = **interactive
click/drag board** · Rules = **chess.js on server (+ in PCF)** · Turn trigger = **auto-send prompt** ·
Sides = **human White, first** · Promotion = **auto-queen** · Controls = **New game + Hint** · Pane card
= **mini board + move**.

## 11. Out of scope (v2)

Promotion picker · resign · undo/takeback · multiple concurrent games / per-record state · move clocks ·
opening book / engine strength knob · drag-and-drop (click-to-move ships first) · saved PGN export.

## 12. Open questions (non-blocking — sensible defaults chosen, flag to change)

- ~~PCF rename vs keep-name~~ — **resolved (§8):** keep `SmokeTestPanel`, rewrite internals only, no
  re-bind.
- **Hint via chat only** (agent suggests, doesn't play). OK? (Default: yes.)
- **State persists across server restarts** (resume the in-progress game). OK, or reset on boot?
  (§3 mandates history-replay persistence *if* we resume; reset-on-boot would just call `newGame()` at
  startup.)
- ~~`GET /state` alias~~ — **resolved (§4):** removed, not aliased.
- ~~ASCII board in `chess_read_board`~~ — **resolved (§5):** PGN-led report, no ASCII board.
