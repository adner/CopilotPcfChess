# declarative-agent/

The **M365 Copilot declarative agent** for this demo, scaffolded with the **Microsoft 365 Agents Toolkit
(ATK)**. The agent is **Copilot Chess** — it plays **Black** against you and makes its moves on the Power
Apps board through the MCP server.

The ATK project lives in `ExperimentAgent/`. It is committed (part of this public sample), but its
**provisioned, tenant-specific IDs in `env/.env.dev` are blanked** — running `teamsapp provision`
repopulates them for your own tenant. Per-user secrets (`env/.env.*.user`) and build output
(`appPackage/build/`) are gitignored.

Two facts to get you started; the rest is a skill:

1. **ATK owns this folder.** Use the M365 Agents Toolkit (VS Code extension or `teamsapp` CLI) to
   provision and publish the agent.
2. **It reaches the MCP server via a `RemoteMCPServer` runtime** in `appPackage/ai-plugin.json`, pointed
   at your server's `/mcp` endpoint (the HTTPS devtunnel base — same as `PUBLIC_BASE_URL`). That URL is a
   placeholder in the committed files; set it to your tunnel before provisioning.

**Everything else — the three-file tool-enumeration sync that must stay aligned every time you add or
rename a server tool (and fails *silently* when it drifts), the `_meta.ui.resourceUri` trap, the
`gptId = M365_TITLE_ID` gotcha, and validation — is in the `declarative-agent-sync` skill.** Run it
whenever you touch the agent.

The two tools this agent calls are **`chess_read_board`** (read-only board report + legal-move list) and
**`chess_make_move`** (a UI tool → its `mcp-tools.json` entry needs
`_meta.ui.resourceUri: "ui://bridge/viewer.html"`; it plays Black, renders the board card, and nudges the
PCF). The prompt that drives a move is **"I played &lt;move&gt;. Your move."** (the PCF submits exactly
this after your move), which `instruction.txt` routes to read-then-move.
