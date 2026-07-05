/**
 * Host-free inner loop — exercise the chess server logic with no MCP client and no Power Apps host.
 *   npm run probe            (defaults to `chess`)
 *   npm run probe chess      -> reset the game, play a couple of moves, print the chess_read_board report,
 *                              assert the illegal / wrong-turn rejection paths, and write the pane card to
 *                              dist/probe-chess.html so you can eyeball the board in a browser.
 * Probe FIRST — settle server logic here before ever touching Copilot or Power Apps.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { configSummary } from "./src/config.js";
import * as store from "./src/store.js";
import { buildReadReport, buildMoveCard } from "./src/tools/chess.js";

function assert(cond: boolean, label: string): void {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const cmd = process.argv[2] ?? "chess";
  console.log("config:\n" + JSON.stringify(configSummary(), null, 2) + "\n");

  if (cmd === "chess") {
    store.newGame();

    // White (human) opens; then it is Black (Copilot) to move.
    const w = store.applyMove("w", { from: "e2", to: "e4" });
    assert(w.ok, "White e2e4 accepted");

    // Wrong-turn: the agent (Black) tool must be rejected when it is... actually it IS Black's turn now,
    // so exercise wrong-turn by having White try to move again out of turn.
    const outOfTurn = store.applyMove("w", "d4");
    assert(!outOfTurn.ok && outOfTurn.reason === "wrong-turn" && outOfTurn.legal.length === 0, "White out-of-turn rejected with NO legal list");

    // Illegal Black move → rejected WITH the legal list so the agent can retry.
    const bad = store.applyMove("b", "e5e6nonsense");
    assert(!bad.ok && bad.reason === "illegal" && bad.legal.length > 0, "Illegal Black move rejected with legal list");

    // Legal Black reply (SAN).
    const b = store.applyMove("b", "c5");
    assert(b.ok, "Black c5 accepted");

    console.log("\n--- chess_read_board report (now White to move) ---\n" + buildReadReport());

    // Force a Black-to-move position to see the full PGN-led report + render a card.
    store.newGame();
    ["e4", "e5", "Nf3", "Nc6", "Bb5"].forEach((m, i) => store.applyMove(i % 2 === 0 ? "w" : "b", m));
    console.log("\n--- chess_read_board report (Black to move) ---\n" + buildReadReport());

    const blackReply = store.applyMove("b", "a6");
    const card = buildMoveCard((blackReply as { game: store.GameSnapshot }).game);
    console.log("\ncard text :", card.text);
    console.log("nudge     :", JSON.stringify({ eventName: "powerapps.copilot.chat.action", action: "template.chess.moved", actionData: card.chess }));
    console.log("html len  :", card.html.length);
    mkdirSync("dist", { recursive: true });
    writeFileSync("dist/probe-chess.html", card.html);
    console.log("wrote     : dist/probe-chess.html (open in a browser to eyeball the board)");
    return;
  }

  console.error(`Unknown probe command: ${cmd}. Try: chess`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
