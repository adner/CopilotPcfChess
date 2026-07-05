---
name: dataverse-mcp-setup
description: >-
  Use when the Dataverse MCP server is not yet reachable from the agent — enabling it on a Power
  Platform environment, registering the Entra ID client app (mcp.tools permission, PKCE, redirect
  URIs), allow-listing the client, and connecting Claude Code / Claude Desktop / GitHub Copilot to
  /api/mcp. Triggers: "set up the Dataverse MCP server", "connect Claude to Dataverse", "mcp.tools",
  "api/mcp", "Dataverse MCP not connected", "enable MCP on the environment", "add the Dataverse MCP
  server".
---

# Setting up the Dataverse MCP server (non-Microsoft clients)

Connect a third-party MCP client (Claude Code, Claude Desktop, GitHub Copilot) directly to Dataverse's
**remote Streamable-HTTP endpoint**. Distilled from
[nullpointer.se — Dataverse MCP with non-Microsoft clients](https://nullpointer.se/dv-mcp-non-microsoft.html)
plus the [MS Learn MCP docs](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/data-platform-mcp).

**Key insight (the article's main point):** use the **remote endpoint + PKCE** — only an Application ID
is needed, **no client secret**. Ignore older docs that recommend a local STDIO proxy for Claude
Desktop/Code; both support the remote endpoint directly, which is simpler and better.

The server URL is always:

```
https://<org>.crm<region>.dynamics.com/api/mcp        e.g. https://contoso.crm4.dynamics.com/api/mcp
```

## 1. Enable the MCP server on the environment (Power Platform admin, once per env)

By default the Dataverse MCP server is enabled **only for Copilot Studio** — non-Microsoft clients
must be explicitly enabled. Requires the **Power Platform administrator** role.

1. [Power Platform admin center](https://admin.powerplatform.microsoft.com/) → **Manage** →
   **Environments** → select the environment → **Settings** → **Product** → **Features**.
2. Find **Dataverse Model Context Protocol**; ensure **Allow MCP clients to interact with Dataverse
   MCP server** is on.
3. Select **Advanced Settings** → the list of MCP client records appears. Open the client you need,
   set **Is Enabled** = **Yes**, **Save & Close**. For a custom Entra app (the Claude path below), add
   its **Application ID** to this allowed-clients list.

Note: this allow-listing gates only the `/api/mcp` agent entrypoint (MCP-named custom APIs are regular
Dataverse APIs and are not restricted by it).

## 2. Register the Entra ID client app (once per tenant)

1. Entra ID → **App registrations** → new registration (name is arbitrary; single tenant is fine).
2. **API permissions** → add the **`mcp.tools`** permission (under the Dataverse/Dynamics CRM API) →
   grant consent per your tenant policy.
3. **Manage → Authentication (Preview) → Settings** → set **Allow public client flows** = **Enabled**
   (this is what makes secret-less PKCE work).
4. Add the **redirect URIs** for every client you'll use:
   - `https://claude.ai/api/mcp/auth_callback` — Claude Desktop
   - `http://localhost/callback` — Claude Code
   - `http://127.0.0.1` — GitHub Copilot app/CLI
5. Note the **Application (client) ID** — it's the only credential any client needs.

## 3. Connect the client

**Claude Code** (one command, then authenticate):

```bash
claude mcp add --transport http --client-id <APPLICATION_ID> DvMCPServer https://<org>.crm<region>.dynamics.com/api/mcp
```

Launch Claude Code, run `/mcp`, and complete the browser sign-in it offers.

**Claude Desktop:** Settings → Connectors → add custom connector → any name + the server URL + the
Application ID (no secret). The OAuth flow runs on first use.

**GitHub Copilot (app/CLI):** Settings → MCP Servers → Add Server → Add Custom Server → HTTP
transport → server URL + Application ID → **Sign in**.

## 4. Verify

`/mcp` should show the server connected with its tool list. Smoke-test with a metadata call
(`describe` on any table) or `read_query` with `SELECT 1 AS ok`. Then switch to the
**dataverse-mcp-usage** skill for query patterns and demo-table creation.

## Tool surface + gotchas

Tools exposed: `search_data` (data search), `search` (metadata/schema search), `read_query`,
`describe`, `create_record` / `update_record` / `delete_record`, `create_table` / `update_table` /
`delete_table`, `upsert_skill` / `delete_skill`, `init_file_upload` / `commit_file_upload` /
`file_download`.

- **Renamed tools:** `describe_table`, `list_tables` and `fetch` were folded into `describe`; the old
  data-searching `search` is now `search_data` (today's `search` searches *metadata*). If your client
  keeps per-tool allow/deny lists, update them to the new names.
- **Billing:** since Dec 15, 2025, Dataverse MCP tool calls from agents outside Copilot Studio consume
  Copilot credits (`search_data` at the tenant-graph-grounding rate; other tools at the basic
  text/generative rate). Dynamics 365 Premium or M365 Copilot USL licenses exempt Dynamics 365 data
  access.
- Auth failures usually mean one of: public client flows not enabled (step 2.3), the redirect URI for
  *that specific client* missing (step 2.4), or the app not allow-listed on the environment (step 1.3).
