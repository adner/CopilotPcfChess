/**
 * Chess tool logic, kept host-free so `npm run probe chess` can drive it with no MCP client / Power Apps.
 *
 *   buildReadReport() → the text `chess_read_board` returns. Ordered to play to an LLM's training
 *     distribution: PGN first, then the legal-move list, explicit piece lists, FEN last (see the spec).
 *   buildMoveCard()   → after Black moves, the { html, chess, text } the `chess_make_move` tool returns.
 *     `html` is the pane card (assembleDocument, inline mode); `chess` is fanned out to the PCF as a
 *     nudge by the viewer (mcp-app.ts) ON RENDER — a server tool cannot postMessage.
 */
import { assembleDocument } from "../assemble-document.js";
import * as store from "../store.js";
import { pieceSvg } from "../chess-pieces.js";
import type { GameSnapshot } from "../store.js";

const PIECE_LETTER: Record<string, string> = { k: "K", q: "Q", r: "R", b: "B", n: "N" };

/** "Black pieces: Ke8, Qd8, Nc6, pawns b7 c7" — explicit placement, reliably parsed by the model. */
function pieceList(color: "w" | "b"): string {
  const officers: string[] = [];
  const pawns: string[] = [];
  for (const rank of store.board()) {
    for (const cell of rank) {
      if (!cell || cell.color !== color) continue;
      if (cell.type === "p") pawns.push(cell.square);
      else officers.push(`${PIECE_LETTER[cell.type]}${cell.square}`);
    }
  }
  const parts = officers;
  if (pawns.length) parts.push(`pawns ${pawns.join(" ")}`);
  return parts.join(", ");
}

/** The report `chess_read_board` returns. Has three leading-line modes: game-over, white-to-move, play. */
export function buildReadReport(): string {
  const g = store.getGame();
  if (g.status === "checkmate" || g.status === "stalemate" || g.status === "draw") {
    return `Game over: ${g.result} (${g.status}). No move to make.`;
  }
  if (g.turn !== "b") {
    return (
      "It is White's turn — it is the human's move, not yours. " +
      "Do not move; tell the user it's their turn."
    );
  }
  const moveNo = Math.floor(g.history.length / 2) + 1;
  return [
    `It is Black to move (move ${moveNo}). You are Black.`,
    `PGN: ${store.movetext() || "(no moves yet)"}`,
    `Legal moves (SAN): ${store.legalMovesSan().join(", ")}`,
    `Black pieces: ${pieceList("b")}`,
    `White pieces: ${pieceList("w")}`,
    `FEN: ${g.fen}`,
    `Flags: check=${g.status === "check"}, lastMove=${g.lastMove?.san ?? "-"}`,
  ].join("\n");
}

/** Human-readable status suffix for a just-played move. */
function statusSuffix(g: GameSnapshot): string {
  switch (g.status) {
    case "checkmate":
      return ` Checkmate — ${g.result}.`;
    case "stalemate":
      return " Stalemate — draw.";
    case "draw":
      return " Draw.";
    case "check":
      return " Check! Your move.";
    default:
      return " Your move.";
  }
}

/** Pre-compute the 8×8 SVG grid (rank 8 first) so the sandboxed render core stays tiny (no FEN parser). */
function cellGrid(): string[][] {
  return store.board().map((rank) => rank.map((cell) => pieceSvg(cell)));
}

// Vanilla render(container, rows): lays out rows[0].cells on an 8×8 board + a caption. MUST append every
// node it creates and call window.__measure() or the pane card stays at the viewer's 220px default. Each
// square carries its OWN aspect-ratio:1/1 so cells stay square even if the host webview ignores a
// container-level aspect-ratio (that mismatch is what makes the board look squished/"weird").
//
// One-time move animation: d.from/d.to carry Black's just-played move. The piece now sitting on `to` is
// placed with an initial transform offset toward `from` (one square = 100/0.84 ≈ 119.05% of the piece
// wrapper, which is 84% of its square), then slid to translate(0,0) once, ~1s after load.
//
// render() runs MORE than once per card — boot() re-invokes it on resize / __measure reflow (see
// assemble-document.ts), which would otherwise replay the slide (the "stutter"). Guard with window flags
// that persist across those re-renders but reset per card load (each tool call is a fresh document):
// until the slide has fired, every render parks the piece at `from` (no stutter, reads as "waiting");
// the slide is scheduled exactly once; afterward every render draws the piece at rest. Skipped when
// from/to don't parse (e.g. the initial "no moves yet" card).
function boardRenderCore(): string {
  return `function render(container, rows){
    container.innerHTML='';
    var d=(rows&&rows[0])||{}; var cells=d.cells||[]; var FILES='abcdefgh';
    var from=d.from||'', to=d.to||'';
    var fromC=from?FILES.indexOf(from.charAt(0)):-1, fromR=from?8-parseInt(from.charAt(1),10):-1;
    var toC=to?FILES.indexOf(to.charAt(0)):-1, toR=to?8-parseInt(to.charAt(1),10):-1;
    var canAnim=(fromC>=0&&fromR>=0&&toC>=0&&toR>=0&&(fromC!==toC||fromR!==toR));
    var pending=(canAnim&&!window.__chessAnimDone); // still parked at origin, waiting to slide
    var wrap=document.createElement('div');
    wrap.style.cssText='display:flex;flex-direction:column;align-items:center;gap:10px;padding:6px 4px';
    var board=document.createElement('div');
    board.style.cssText='display:grid;grid-template-columns:repeat(8,1fr);width:100%;max-width:320px;border:2px solid #8a6a49;border-radius:4px;overflow:hidden;box-shadow:0 4px 16px rgba(20,30,50,.18)';
    for(var r=0;r<8;r++){ for(var c=0;c<8;c++){
      var light=((r+c)%2===0);
      var sq=document.createElement('div');
      sq.style.cssText='position:relative;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;background:'+(light?'#eadfce':'#9c7a55');
      // coordinate labels: files along the bottom rank, ranks along the a-file.
      if(r===7){ var fl=document.createElement('span'); fl.textContent=FILES[c]; fl.style.cssText='position:absolute;right:2px;bottom:1px;font-size:8px;font-weight:700;opacity:.75;color:'+(light?'#9c7a55':'#eadfce'); sq.appendChild(fl); }
      if(c===0){ var rk=document.createElement('span'); rk.textContent=String(8-r); rk.style.cssText='position:absolute;left:2px;top:1px;font-size:8px;font-weight:700;opacity:.75;color:'+(light?'#9c7a55':'#eadfce'); sq.appendChild(rk); }
      var svg=(cells[r]&&cells[r][c])||'';
      if(svg){ var pc=document.createElement('div'); pc.style.cssText='width:84%;height:84%;line-height:0;filter:drop-shadow(0 1px 1px rgba(0,0,0,.22))'; pc.innerHTML=svg;
        if(pending&&r===toR&&c===toC){ var K=119.05; pc.id='__chessAnimPc'; pc.style.transition='none'; pc.style.transform='translate('+((fromC-toC)*K)+'%,'+((fromR-toR)*K)+'%)'; pc.style.zIndex='5'; }
        sq.appendChild(pc); }
      board.appendChild(sq);
    }}
    var cap=document.createElement('div');
    cap.style.cssText='font-size:14px;font-weight:600;color:var(--fg);text-align:center';
    cap.innerHTML=d.caption||'';
    wrap.appendChild(board); wrap.appendChild(cap);
    container.appendChild(wrap);
    if(pending&&!window.__chessAnimScheduled){ window.__chessAnimScheduled=true;
      setTimeout(function(){ window.__chessAnimDone=true; var p=document.getElementById('__chessAnimPc');
        if(p){ p.style.transition='transform 450ms cubic-bezier(.22,.61,.36,1)'; requestAnimationFrame(function(){ p.style.transform='translate(0,0)'; }); }
      }, 1000); }
    if(window.__measure) window.__measure();
  }`;
}

export interface MoveCard {
  html: string;
  chess: { fen: string; san: string; from: string; to: string; status: string; result: string | null };
  text: string;
}

/** Build the pane card + nudge payload for the game as it stands (call right after Black's move). */
export function buildMoveCard(g: GameSnapshot): MoveCard {
  const san = g.lastMove?.san ?? "?";
  const caption = `Black played <b>${san}</b>.${statusSuffix(g)}`;
  const html = assembleDocument(
    boardRenderCore(),
    {
      mode: "inline",
      rows: [{ cells: cellGrid(), caption, from: g.lastMove?.from ?? "", to: g.lastMove?.to ?? "" }],
    },
    { title: "Copilot's move" },
  );
  return {
    html,
    chess: {
      fen: g.fen,
      san,
      from: g.lastMove?.from ?? "",
      to: g.lastMove?.to ?? "",
      status: g.status,
      result: g.result,
    },
    text: `Black played ${san}.${statusSuffix(g)}`,
  };
}
