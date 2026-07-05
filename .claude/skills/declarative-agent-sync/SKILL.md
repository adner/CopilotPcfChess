---
name: declarative-agent-sync
description: >
  Wire the M365 Copilot declarative agent (Agents Toolkit / ATK) to the template's MCP server, and keep
  its tool list in sync with the server. Use whenever you add/rename/remove a server tool, when "the agent
  can't see my tool" / "the tool isn't being called" / "the pane card doesn't render", when scaffolding or
  publishing the agent, or when editing appPackage/{mcp-tools.json, ai-plugin.json, instruction.txt}.
  Always run this right after mcp-apps-tool-dev — a server tool is invisible to Copilot until the agent is synced.
---

# Keeping the declarative agent in sync with the MCP server

The agent is a **Microsoft 365 Agents Toolkit (ATK)** declarative agent — manifests only, no app logic.
It consumes the server as a **RemoteMCPServer** runtime. You scaffold it with ATK into `declarative-agent/`
(the template ships only a placeholder + pointer). Everything below is the recurring work.

## The wiring chain

`manifest.json` → `declarativeAgent.json` → `ai-plugin.json` (the Action) → `mcp-tools.json` (tool schemas).
The MCP server is bound in `ai-plugin.json` as a runtime pointing at your **devtunnel** `/mcp`:

```json
"runtimes": [
  {
    "type": "RemoteMCPServer",
    "spec": { "url": "https://<id>-3101.<region>.devtunnels.ms/mcp",
              "mcp_tool_description": { "file": "mcp-tools.json" } },
    "run_for_functions": ["smoke_test"],
    "auth": { "type": "None" }
  }
]
```

Instructions come from `instruction.txt` (referenced by `declarativeAgent.json`).

## THE THREE-FILE SYNC (the thing that bites)

Although the runtime *discovers* tools from `/mcp`, this project **pins** them explicitly. Every time you
add, rename, or remove a server tool you must update **all three** lists, or they drift:

1. **`appPackage/mcp-tools.json` → `tools[]`** — the full per-tool schema:
   ```json
   {
     "name": "smoke_test",
     "title": "Smoke test",
     "description": "…what it does; how the model should decide to call it…",
     "inputSchema": { "type":"object", "properties":{ … }, "required":[…],
                      "additionalProperties": false, "$schema": "http://json-schema.org/draft-07/schema#" },
     "execution": { "taskSupport": "forbidden" },
     "_meta": { "ui": { "resourceUri": "ui://…/viewer.html" }, "ui/resourceUri": "ui://…/viewer.html" }
   }
   ```
2. **`appPackage/ai-plugin.json` → `functions[]`** — `{ name, description }` per tool, **and**
   **`run_for_functions[]`** — the array that **gates which discovered tools the agent may call**. A tool
   missing from `run_for_functions` is discovered but never invoked.
3. **`appPackage/instruction.txt` → the `## Your tools` prose** + behavior/routing guidance so the model
   reliably maps a user phrase to the right tool.

### Fails SILENTLY when missed

There is no error when these drift — the tool is simply **absent from Copilot** (or discovered but never
called, or its pane card never renders). Symptoms and their missing piece:

- Tool never called → not in **`run_for_functions[]`**, or not described in **`instruction.txt`**.
- **Pane card never renders** → the tool's `mcp-tools.json` entry is **missing `_meta.ui.resourceUri`**.
  This is the single easiest piece to forget for a UI (registerAppTool) tool. If your tool renders UI,
  its `mcp-tools.json` entry MUST carry `_meta.ui.resourceUri` pointing at the same viewer URI the server
  registers.
- Tool present but the model calls the wrong one → sharpen the `description` (in BOTH `mcp-tools.json` and
  `ai-plugin.json`) and add explicit routing in `instruction.txt`.

## gptId gotcha

The PCF targets the agent by **gptId**, which is the **`M365_TITLE_ID`** (form `T_<guid>` for tenant, or
`U_<guid>.declarativeAgentPowerApps` for user-scoped) — **NOT `TEAMS_APP_ID`**. Both live in
`env/.env.dev`; it is easy to grab the wrong one. Verify the live value by opening the agent in the
Copilot pane and running `Xrm.Copilot.getCurrentAgent()` in DevTools.

## What's safe to edit vs generated

- **Edit:** `mcp-tools.json`, `ai-plugin.json`, `instruction.txt`, `declarativeAgent.json`
  (`conversation_starters`), `env/.env.dev`.
- **Never edit:** `appPackage/.generated/**` and `appPackage/build/**` — ATK outputs.
- ATK's **"Fetch Action from MCP"** command re-pulls the tool schemas from a running `/mcp` and is the
  *canonical* refresh — but it's interactive (VS Code). Hand-editing the three lists to the exact sibling
  shapes is acceptable and ATK-reconcilable later; just keep them in sync.

## Validate before publishing

1. **JSON parses** for all edited files.
2. **List sync:** the tool-name sets in `mcp-tools.json` `tools[]`, `ai-plugin.json` `functions[]`, and
   `run_for_functions[]` are identical. (Parse with `node -e` — `jq` isn't available on this machine.)
3. **ATK validation:** run `teamsApp/validateAppPackage` (via the ATK provision lifecycle) — it zips and
   validates the built package.

The `declarative-agent/README.md` in the template is a thin pointer here; this skill is the source of truth.
After any server-tool change, do the three-file sync and re-validate; if the loop still misbehaves, see
`bridge-troubleshooting`.
