# Play chess against M365 Copilot — PCF ↔ declarative agent ↔ MCP bridge

A working demo of **bi-directional communication** between a model-driven Power Apps **PCF component**
and an **M365 Copilot declarative agent**, brokered by an **MCP (Apps) server**. You play **White** on
an interactive chess board rendered by the PCF; **Copilot plays Black** through a declarative agent that
calls the MCP server. It exercises the Power Apps `Xrm.Copilot` client APIs
([reference](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/xrm-copilot),
[agent APIs](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/bring-intelligence-using-agent-apis))
and the postMessage/nudge bridge between the two surfaces.

> Built from the reusable starter template
> **[adner/CopilotPcf_Template](https://github.com/adner/CopilotPcf_Template)** — start there if you want
> the bare bridge (a one-button "smoke test" loop) to build your own demo on. This repo is that template
> filled in as a chess game.

## The loop

```
   ┌─────────────────────────┐   sendPromptToM365Copilot("I played e4. Your move.", gptId)   ┌───────────────┐
   │  PCF: chess board        │ ────────────────────────────────────────────────────────────▶│  M365 Copilot  │
   │  (model-driven app)      │                                                               │  "Copilot Chess"│
   │  human plays White       │                                                               │  agent (Black) │
   │                          │            nudge postMessage (dual-registered)                └───────┬───────┘
   │  ▲  "Copilot moved —     │◀───────────────────────────────────────────────────────────          │ calls
   │  │   your turn."         │                                                                       ▼
   │  │                       │                              ┌──────────────────┐          ┌───────────────────┐
   │  └─ GET /game ──HTTP─────┼──▶ shared game state ◀───────│  viewer renders  │◀─────────│ chess_read_board  │
   │     POST /move           │      (chess.js, server)      │  board card +    │          │ chess_make_move   │
   └─────────────────────────┘                              │  fans the nudge  │          │  (MCP tools)      │
                                                            └──────────────────┘          └───────────────────┘
```

1. **PCF → Copilot.** You click a piece and a legal target. The move is `POST`ed to the server (the
   single source of truth, backed by `chess.js`), then the panel calls
   `Xrm.Copilot.openM365CopilotPanel()` + `sendPromptToM365Copilot("I played <move>. Your move.",
   { autoSubmit:true, gptId })`.
2. **Copilot → PCF.** The *Copilot Chess* agent calls **`chess_read_board`** (read-only — PGN history +
   the legal-move list so it stays legal), picks a move, then calls **`chess_make_move`** to play Black.
   That tool's viewer renders a board card **in the Copilot pane** (with a one-time slide animation of the
   move) **and fans a nudge back** to the host on render — a server tool can't `postMessage`, so the
   fan-out is client-side.
3. **Reconcile.** The PCF receives the nudge via **dual registration** (`Xrm.Copilot.addActionHandler`
   **and** a raw `window` `message` listener), then re-reads the authoritative board via `GET /game` and
   repaints. A poll backstop (`autoRefreshSeconds`) covers a missed nudge.

The agent is prompted to **explain the reasoning behind each move**, so the chat reads like playing a
person who thinks out loud.

## Components

| Folder | What it is |
|---|---|
| `mcp-server/` | Node + TS MCP (Apps) server + plain web server. The reusable bridge plumbing + the chess tools `chess_read_board` and `chess_make_move`; the authoritative game (`src/store.ts`, `chess.js`). |
| `pcf-control/` | Full-page dataset PCF `Bridge.SmokeTestPanel` (class name kept for grid-binding stability) — the interactive board you play White on, the captured-pieces panel, and the bridge send/receive wiring. |
| `declarative-agent/` | The ATK declarative agent **Copilot Chess** (plays Black). Committed here; provision it into your own tenant (its provisioned IDs in `env/.env.dev` are blanked — see *Full loop* below). |
| `.claude/skills/` | Bundled skills carrying the hard-won lessons (see below). |

## Quick start (host-free, ~2 min)

You can drive the whole server side with no Power Apps host at all:

```bash
cd mcp-server
cp .env.example .env          # set STATE_KEY; PUBLIC_BASE_URL can stay localhost for the probe
npm install
npm run probe chess           # resets + plays a few moves, prints the read report + nudge,
                              #   writes dist/probe-chess.html
npm run build && npm run serve # MCP on http://localhost:3101/mcp  (health: /health)
```

Open `mcp-server/dist/probe-chess.html` in a browser to eyeball the board card (and its move animation).

## Full loop (deployed)

You need: an HTTPS **devtunnel** (localhost is silently blocked as mixed content inside the HTTPS Power
App), the `pac` CLI, and the M365 Agents Toolkit (ATK).

> **The critical coupling** — these four must be the *same* HTTPS base or the loop breaks silently:
> `PUBLIC_BASE_URL` (`mcp-server/.env`) == the PCF control's **`serverBaseUrl`** property == the PCF
> manifest **`external-service-usage`** domain == the **`RemoteMCPServer` url** in the agent's
> `ai-plugin.json`.

1. **Tunnel + serve.** `devtunnel host -p 3101 --allow-anonymous`; set `PUBLIC_BASE_URL` in
   `mcp-server/.env` to the `https://…devtunnels.ms` base; `npm run build && npm run serve`.
2. **PCF.** In `pcf-control/`: set the manifest `external-service-usage` `<domain>` to the tunnel base
   (bump the control version), `npm install && npm run build`, `pac pcf push --publisher-prefix bridge`,
   then bind it as a table's grid control with `npm run bind -- …` (see the `pcf-develop-deploy` skill —
   the classic picker won't list a dataset PCF, so this is scripted). Configure the control:
   `serverBaseUrl` = the tunnel base, `stateKey` = your `STATE_KEY`, `autoRefreshSeconds` = `30`. Leave
   `agentId` for now — you set it after provisioning the agent (next step).
3. **Agent.** In `declarative-agent/ExperimentAgent/`, point the `RemoteMCPServer` url in
   `appPackage/ai-plugin.json` (and `.vscode/mcp.json`) at `<tunnel>/mcp`, then provision + publish with
   ATK (`teamsapp provision`, then publish). Provisioning repopulates the blanked IDs in `env/.env.dev`
   for your tenant. If you change tools, re-run the three-file tool-enumeration sync (see the
   `declarative-agent-sync` skill).
4. **Set the gptId on the board (required).** The PCF must know *which* declarative agent to send your
   moves to — this is the agent's **gptId**, which is the `M365_TITLE_ID` value ATK writes into
   `declarative-agent/ExperimentAgent/env/.env.dev` on provision (a `T_<guid>` string). Copy it, then on
   the PCF page **expand the collapsed "⚙ Agent settings" section at the bottom of the component** and
   paste it into the **gptId** field. Without this the panel saves your move but has no agent to hand off
   to, and the status line tells you to open Agent settings. (You can instead bake it into the control's
   `agentId` bind property, but the Agent settings pane is the quick, no-rebind way — set it once and
   collapse the section again.)
5. **Play.** Open the PCF page, drag/click a White move → the Copilot pane shows *Copilot Chess* reading
   the board and replying as Black with a rendered board card and its reasoning → the PCF repaints and
   shows **"Copilot moved — your turn."** Captured pieces accrue in the panel beside the board.

## Bundled skills (`.claude/skills/`)

Claude Code loads these on demand while you work in this repo:

- **xrm-copilot-integration** — the `Xrm.Copilot` API surface from both a PCF and an MCP Apps widget; the gptId gotcha.
- **pcf-develop-deploy** — pac dev/deploy, the version-bump rule, and the scripted grid-binding (`bind-grid.mjs`).
- **dataverse-mcp-usage** — query Dataverse + create supporting demo tables via the Dataverse MCP server.
- **dataverse-mcp-setup** — enable the Dataverse MCP server on an environment and connect a non-Microsoft client (Entra app, PKCE).
- **bidirectional-pcf-agent** — the nudge protocol, dual registration, shared state, and the HTTPS/CSP/sandbox constraints.
- **mcp-apps-tool-dev** — adding/modifying tools on the server.
- **declarative-agent-sync** — the ATK flow + the three-file tool-enumeration sync that fails silently.
- **bridge-troubleshooting** — symptom → cause → fix for every loop failure mode.

## A note on MCP consent

Both chess tools carry `annotations.readOnlyHint: true`, which is the only lever M365 Copilot honors to
suppress the per-call approval prompt. `chess_read_board` is genuinely read-only; `chess_make_move`
**does** mutate the game but is deliberately marked read-only so play isn't interrupted by an approval on
every Black move (documented in `mcp-server/server.ts`). Don't copy that shortcut to a tool with real
side effects.

## Credits & licenses

- Chess piece artwork: the **Cburnett** set by **Colin M.L. Burnett**, from
  [lichess-org/lila](https://github.com/lichess-org/lila/tree/master/public/piece/cburnett) (originally
  Wikimedia Commons). Multi-licensed by the author (GFDL 1.2+ / CC BY-SA 3.0 / BSD 3-Clause / GPLv2+);
  redistributed here under **BSD 3-Clause**.
- Game logic: [chess.js](https://github.com/jhlywa/chess.js) by Jeff Hlywa (**BSD 2-Clause**).

Full attribution and license texts for both are in [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md).
Built from the [CopilotPcf_Template](https://github.com/adner/CopilotPcf_Template) starter.
