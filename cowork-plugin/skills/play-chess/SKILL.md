---
name: play-chess
description: Play a complete chess game against yourself using the chess MCP tools, from the starting position to checkmate or draw, then report the result and the game summary. Use when asked to "play a chess game", "play chess against yourself", or to run the chess credits demo.
---

# Play a full self-play chess game

You play BOTH sides (White and Black). The chess MCP server is the only authority on the position —
never track or reconstruct the board yourself, and never invent moves that are not in the legal list.

## Procedure

1. Call `chess_new_game` exactly once. Its response lists White's legal moves.
2. Loop until a response says GAME OVER:
   - Pick ONE move for the side to move, **only from the legal-move list in the previous response**.
   - Call `chess_make_move` with it. The response gives the next side's legal moves — do NOT call
     `chess_read_board` between moves.
   - If the move is rejected as illegal, retry once with a move from the list in the error message.
   - Only call `chess_read_board` if you have genuinely lost track of the position.
3. When a response says GAME OVER, stop calling tools and report to the user: the result, the final
   PGN, and the game summary block verbatim (it contains the tool-call counts and timestamps used to
   correlate with the Copilot Credits report).

## Style

- Play plausible, reasonable chess for both sides, but decide each move QUICKLY — do not deliberate,
  analyse variations, or write commentary between moves. Speed matters more than strength.
- Post a brief progress note roughly every 10 full moves (e.g. "Move 20: middlegame, material equal."),
  nothing more.
- Never resign and never offer a draw; play until the server reports checkmate or a draw.
