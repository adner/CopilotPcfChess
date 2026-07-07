# CLAUDE.md

Guidance for Claude Code working in this repo. **Authoring rule:** procedural knowledge → a skill in
`.claude/skills/`; always-true, load-bearing facts → this file; human narrative (diagrams, setup
walkthrough) → `README.md`. Keep this file a map, not a manual.

## THIS BRANCH: the Cowork self-play / Copilot Credits demo

**`claude/cowork-chess-plugin-w5s77r` is a different use case than `main`.** Here the demo is a
**Copilot Cowork plugin** (`cowork-plugin/`): Cowork plays a full chess game **against itself** (both
sides) through the MCP server, so the user can measure the **Copilot Credits** a full game consumes.
Consequences that override the `main`-demo facts below:

- The MCP plane is **headless** — three plain-text tools: `chess_new_game`, `chess_make_move`
  (any-side via `store.applyMoveForTurn`; response embeds the NEXT side's legal moves), and
  `chess_read_board` (recovery only). No MCP-Apps cards, no viewer resource, no PCF nudge,
  no `structuredContent`. Per-game telemetry (tool-call counts, start/end) is persisted with the game
  and reported in the game-over summary for credit correlation.
- **`npm run build` is NOT required before `npm run serve`** (the viewer is unhooked). New command:
  `npm run package:cowork` (validates + zips `cowork-plugin/dist/cowork-chess-plugin.zip`).
- **Critical coupling on this branch:** `PUBLIC_BASE_URL` (mcp-server/.env) == the plugin manifest's
  `mcpServerUrl` base == the **anonymous-access** HTTPS devtunnel. Re-run `package:cowork` + re-upload
  the zip whenever the tunnel changes.
- **Manifest is v1.28** (`manifestVersion: "1.28"` + `v1.28` schema — NOT `devPreview`). The v1.28
  schema **requires** `agentConnectors[].toolSource.remoteMcpServer.mcpToolDescription.file`, so the
  package ships **`cowork-plugin/toolDescription.json`** — a static tool declaration that MUST mirror
  the tools in `mcp-server/server.ts` (this is the branch's one sync burden, analogous to the
  declarative agent's `mcp-tools.json`). `build.mjs` fails the package if the tool names drift or a
  tool lacks a `readOnlyHint`/`destructiveHint` annotation. Cowork also does runtime `tools/list`
  discovery, but the static file is schema-mandatory. Headless → no `_meta.ui` in the file.
  (Note: `packageName` is NOT allowed at the v1.28 root.)
- The `declarative-agent-sync` skill does not apply, but the *idea* does: a tool change in `server.ts`
  needs the matching edit to `toolDescription.json`. The PCF control, viewer sources (`src/mcp-app.ts`,
  `buildMoveCard`), web plane, and declarative agent stay in-tree but **unused**.
- Human narrative (sideload steps, running the demo, reading the Credits report) → `cowork-plugin/README.md`.

## What this repo is

A **starter template** for demos that show **bi-directional communication** between a model-driven
Power Apps **PCF component** and an **M365 Copilot declarative agent**, brokered by an **MCP (Apps)
server**. It exercises the `Xrm.Copilot` client APIs and the postMessage/nudge bridge. Three
components:

- **`mcp-server/`** — Node + TypeScript MCP (Apps) server, also a plain web server. Ships the
  reusable plumbing + the chess tools **`chess_read_board`** and **`chess_make_move`**.
- **`pcf-control/`** — a full-page dataset PCF (`Bridge.SmokeTestPanel`; class name kept for grid-binding
  stability) that renders the interactive chess board and drives the bridge.
- **`declarative-agent/ExperimentAgent/`** — the ATK declarative agent (Copilot plays Black); see the
  `declarative-agent-sync` skill. **Gitignored.**

The **app is chess vs. Copilot**: the human plays White on the PCF board → each move is POSTed to the
server (source of truth, `chess.js`) and a "your move" prompt is auto-submitted to M365 Copilot → the
agent calls `chess_read_board` then `chess_make_move` → the viewer renders a board card **and nudges the
PCF**, which reconciles via `GET /game`. Full design + decisions live in **`copilotpcfchess.md`**.

## Commands (run in `mcp-server/`)

```bash
npm install
npm run probe chess     # host-free: scripted self-play to mate, asserts + prints reports & credit summary
npm run serve           # Streamable HTTP on :3101/mcp  (health: /health) — no build step needed
npm run package:cowork  # validate + zip the Cowork plugin package (cowork-plugin/dist/)
npm run typecheck       # tsc on BOTH tsconfigs (server + DOM viewer)
npm run build           # (main-demo leftover) bundle the viewer — NOT needed on this branch
```

In `pcf-control/`: `npm install`, `npm run build`, `npm run bind -- …` (grid binding; see
`pcf-develop-deploy`). **No test runner** — verification is `npm run probe` + the manual loop.

## Always-true conventions

- **ESM throughout** (`"type":"module"`); relative imports use `.js` extensions even from `.ts`.
- **Two tsconfigs** in `mcp-server/`: `tsconfig.server.json` (Node; excludes the DOM viewer) and
  `tsconfig.json` (DOM; for `src/mcp-app.ts`). `typecheck` runs both.
- **`npm run build` before `npm run serve`**, or the viewer resource serves a "not built" fallback.
- **Config is centralized** in `mcp-server/src/config.ts` (`requireConfig`); `mcp-server/.env` is
  gitignored and holds real secrets — never log, echo, or commit it.

## The critical coupling (breaks silently when violated)

`PUBLIC_BASE_URL` (mcp-server/.env)  ==  PCF `serverBaseUrl` property  ==  the manifest
`external-service-usage` domain  ==  **the HTTPS devtunnel base**. An `http://localhost` server URL is
silently blocked as mixed content inside the HTTPS Power App. The **nudge envelope** is likewise
shared and must match on both ends: `mcp-server/src/mcp-app.ts` and `pcf-control/SmokeTestPanel/index.ts`
both use `eventName:"powerapps.copilot.chat.action"`, `action:"template.chess.moved"`.

## Skills — invoke the matching one before you act

- Add / change a **server tool** → `mcp-apps-tool-dev`, **then** `declarative-agent-sync`.
- **PCF** build / push / grid-binding → `pcf-develop-deploy` (bump the manifest version every push).
- Query Dataverse / create demo **tables** → `dataverse-mcp-usage`; Dataverse MCP server **not
  connected/configured yet** → `dataverse-mcp-setup`.
- Bridge / nudge / shared-state **design** → `bidirectional-pcf-agent`, `xrm-copilot-integration`.
- **Loop broken** (blank widget, nudge not arriving, mixed content, stale bundle) →
  `bridge-troubleshooting`.

## Fill in as your demo grows

Every clone becomes a different demo. Append the demo-specific, always-true facts here as you build:

- **Data model:** `cr19f_pcfexperiment` (display "PCF Experiment") — host surface only for the
  full-page PCF; records are ignored. Created via `dataverse-mcp-usage` with the env default publisher
  prefix `cr19f` (NOT the PCF push prefix). Primary name col `cr19f_pcfexperimentname` + a `cr19f_title`.
- **Tools:** `chess_read_board` (read-only; PGN-led board report + legal-move list) and `chess_make_move`
  (UI tool; plays Black, renders the board card, nudges the PCF). `smoke_test` removed. The authoritative
  game lives in `mcp-server/src/store.ts` (`chess.js`, persisted to the state file). Each tool change
  needs the 3-file agent sync (`declarative-agent-sync`). Piece SVGs are duplicated in
  `mcp-server/src/chess-pieces.ts` and `pcf-control/SmokeTestPanel/pieces.ts` (keep in sync).
- **Environment / deployment** (values below are placeholders — the real, per-tenant values live in the
  gitignored `mcp-server/.env` and your provisioned ATK `env/.env.dev`; fill your own):
  - Dataverse env: your org, e.g. `https://<your-org>.crm.dynamics.com` (pac auth + Dataverse MCP both
    target this org).
  - Hosting table: `cr19f_pcfexperiment`; PCF control `bridge_Bridge.SmokeTestPanel` bound as its grid
    control (dataset `bridgeGrid`) via `bind-grid.mjs`. PCF push publisher prefix: **`bridge`**.
  - The grid binding (`CustomControlDefaultConfigs`) is carried by the unmanaged solution **`CmpTemp0`** —
    do NOT delete it; deleting the carrier solution removes the binding and the default grid returns.
    (`CustomControlDefaultConfigs` must sit at the OUTER `<Entity>` level, not inside inner `<entity>`.)
  - Devtunnel base: `https://<your-tunnel>-3101.<region>.devtunnels.ms` (e.g. port 3101). This is
    `PUBLIC_BASE_URL` (mcp-server/.env) == PCF `serverBaseUrl` == manifest `<domain>`.
  - `STATE_KEY` lives in `mcp-server/.env` (gitignored) and is baked into the PCF `stateKey` bind prop;
    `autoRefreshSeconds=30` (nudge + poll backstop). `agentId` (gptId, `M365_TITLE_ID`) is set on the
    panel (or the bind) once `ExperimentAgent` is provisioned — open **Agent settings** on the panel and
    paste it. **Keeping the control name `SmokeTestPanel` means NO grid re-bind** — the existing
    `CmpTemp0` binding still resolves; just bump the manifest version and `pac pcf push`.
  - Verify grid at: `https://<your-org>.crm.dynamics.com/main.aspx?pagetype=entitylist&etn=cr19f_pcfexperiment`
