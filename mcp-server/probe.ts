/**
 * Host-free inner loop — exercise the headless self-play chess logic with no MCP client and no Copilot.
 *   npm run probe            (defaults to `chess`)
 *   npm run probe chess      -> reset the game, assert the illegal/game-over rejection paths, script a
 *                              Fool's-mate self-play game (both sides via applyMoveForTurn), print every
 *                              move report, and print + assert the game-over credit summary.
 * Probe FIRST — settle server logic here before ever touching Cowork.
 */
import { configSummary } from "./src/config.js";
import * as store from "./src/store.js";
import { buildReadReport, buildMoveReport, buildGameSummary } from "./src/tools/chess.js";

function assert(cond: boolean, label: string): void {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const cmd = process.argv[2] ?? "chess";
  console.log("config:\n" + JSON.stringify(configSummary(), null, 2) + "\n");

  if (cmd === "chess") {
    store.newGame();
    store.bumpToolCall("chess_new_game");

    const start = buildReadReport();
    console.log("--- starting report (chess_new_game / chess_read_board) ---\n" + start + "\n");
    assert(start.startsWith("It is White to move"), "starting report says White to move");
    assert(start.includes("Legal moves for White"), "starting report carries White's legal list");

    // Illegal move → rejected WITH the legal list so the caller can retry.
    const bad = store.applyMoveForTurn("Qh5"); // illegal from the start position
    assert(!bad.ok && bad.reason === "illegal" && bad.legal.length > 0, "illegal move rejected with legal list");

    // Scripted self-play to the fastest mate (Fool's mate): both sides through applyMoveForTurn.
    for (const san of ["f3", "e5", "g4", "Qh4#"]) {
      store.bumpToolCall("chess_make_move");
      const r = store.applyMoveForTurn(san);
      assert(r.ok, `self-play move ${san} accepted`);
      if (r.ok) console.log("\n--- chess_make_move report ---\n" + buildMoveReport(r.game));
    }

    const g = store.getGame();
    assert(g.status === "checkmate", "final status is checkmate");
    assert(g.result === "0-1", "result is 0-1 (Black wins)");

    // Game-over guard: any further move is refused.
    const after = store.applyMoveForTurn("e4");
    assert(!after.ok && after.reason === "game-over", "post-mate move rejected as game-over");

    const summary = buildGameSummary();
    console.log("\n--- game summary ---\n" + summary);
    assert(summary.includes("Plies: 4"), "summary counts 4 plies");
    assert(summary.includes("chess_make_move=4"), "summary counts 4 chess_make_move calls");
    assert(!summary.includes("Ended: -"), "summary has a non-null Ended timestamp");
    return;
  }

  console.error(`Unknown probe command: ${cmd}. Try: chess`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
