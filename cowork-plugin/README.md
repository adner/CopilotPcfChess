# Cowork chess plugin — how many Copilot Credits does a chess game cost?

A [Copilot Cowork plugin](https://learn.microsoft.com/en-us/microsoft-365/copilot/cowork/cowork-plugin-development)
that has Cowork play a **full chess game against itself** (both sides) through the MCP server in
`../mcp-server/`. No UI — the server is the single source of truth for the position (chess.js, PGN).
The point of the demo is to measure how many **Copilot Credits** one complete game consumes.

## How it works

- The plugin package (a Teams-style app package zip) declares:
  - an **agent connector** → the MCP server at `PUBLIC_BASE_URL/mcp` (auth: None). Cowork discovers the
    tools dynamically via `tools/list` — no tool manifest to maintain.
  - an **agent skill** (`skills/play-chess/SKILL.md`) → the self-play loop: `chess_new_game` once, then
    `chess_make_move` per ply (each response embeds the next side's legal moves, so no board-read
    between moves), stop at checkmate/draw and report the summary.
- Every game the server counts tool calls and timestamps start/end. The game-over response includes a
  summary block (plies, tool calls per tool, duration) you correlate with the Credits report.

## Build the package

```bash
cd ../mcp-server
npm install
npm run package:cowork      # validates + writes cowork-plugin/dist/cowork-chess-plugin.zip
```

The script substitutes `PUBLIC_BASE_URL` from `mcp-server/.env` into the manifest, validates the
package (required fields, icon sizes, skill frontmatter, and the manifest against its `$schema` — the
schema is fetched live from developer.microsoft.com; pass `--schema <path|url>` to override, e.g.
`npm run package:cowork -- --schema ./MicrosoftTeams.schema.json`), then zips it. Re-run + re-upload
whenever your devtunnel URL changes.

## Run the demo

1. **Serve**: `cd ../mcp-server && npm run serve` (port 3101; `npm run build` is NOT needed on this branch).
2. **Tunnel**: expose it over HTTPS with **anonymous access**, e.g.
   `devtunnel host -p 3101 --allow-anonymous`. Put the resulting base URL in `mcp-server/.env` as
   `PUBLIC_BASE_URL=https://<tunnel>-3101.<region>.devtunnels.ms` and re-run `npm run package:cowork`.
3. **Sideload**: M365 Admin Center → **Settings → Integrated apps → Upload custom apps** (or the Teams
   admin center) → upload `dist/cowork-chess-plugin.zip`. Then in **Cowork → Sources & Skills**, enable
   the plugin. (Requires Frontier-program access to Cowork and admin rights to sideload.)
4. **Play**: ask Cowork — *"Play a full chess game against yourself using the play-chess skill."*
   Cowork alternates White and Black until the server reports checkmate or a draw, then posts the final
   PGN + game summary.
5. **Measure**: in the M365 admin center open the **Copilot Credits / billing & usage report** and
   correlate the consumption in the game's time window with the summary's `Started`/`Ended` timestamps
   and tool-call counts.

## Notes & limitations (demo-grade)

- **One global game**: all sessions share one board (`mcp-server` state file). Don't run two games at
  once — they'd interleave and ruin the measurement. Always start runs with a fresh `chess_new_game`
  (the skill does this), which also resets the telemetry counters.
- **Consent prompts**: the tools carry `readOnlyHint` so hosts don't prompt per ply (~80 calls/game).
  If Cowork still asks, choose **Always allow** on the first call — per-move prompts would distort the
  measurement.
- **Tool-call shape**: embedding the legal-move list in each `chess_make_move` response roughly halves
  the calls per game. For a worst-case measurement instead, edit `skills/play-chess/SKILL.md` to demand
  a `chess_read_board` before every move (package-only change).
- **Auth is None** — anyone with the tunnel URL can move pieces. Don't leave the tunnel up.
- **Game length**: engine-less self-play can wander; chess.js's draw rules (50-move, threefold,
  insufficient material) guarantee termination eventually.

## Troubleshooting

- **Tools don't show up in Cowork**: check the tunnel — `curl https://<tunnel-base>/health` must answer;
  the manifest's `mcpServerUrl` must be the *current* tunnel (`npm run package:cowork` prints it);
  re-upload after every tunnel change.
- **"Schema validation SKIPPED" during packaging**: you were offline or developer.microsoft.com was
  unreachable; the structural checks still ran. Re-run online or pass `--schema`.
- **Schema errors like `/ must NOT have additional properties`**: the hosted devPreview schema copy you
  validated against predates the Cowork fields (`agentSkills`/`agentConnectors`). Get a current schema
  and pass it via `--schema`, or fall back to the structural checks.
- **Upload rejected**: the zip must have `manifest.json`, `color.png` (192×192), `outline.png` (32×32)
  at its root and the skill under `skills/play-chess/SKILL.md` — `npm run package:cowork` builds exactly
  that layout; don't re-zip by hand from a folder (that nests everything one level down).
