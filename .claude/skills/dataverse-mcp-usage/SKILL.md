---
name: dataverse-mcp-usage
description: >-
  Use when a demo needs to read from or create supporting structures in Dataverse via the Dataverse MCP
  server (assumed already configured and connected). Covers read-only queries, creating demo tables and
  columns, the publisher-prefix gotcha, and how logical names map to the TDS/SQL endpoint. Triggers:
  "query Dataverse", "read_query", "create a table", "create_table", "Dataverse MCP", "hosting table",
  "supporting table for the demo", "what columns does <table> have".
---

# Using the Dataverse MCP server

This template assumes a **Dataverse MCP server is set up and accessible to the agent** — if it isn't
yet, run the **dataverse-mcp-setup** skill first; this skill is about *using* it, not configuring it. Typical tools:
`read_query`, `describe`, `search` / `search_data`, `create_table`, `update_table`, `create_record`,
`update_record`, `delete_record`, `delete_table`.

## Reading data (read-only queries)

`read_query` runs **T-SQL SELECT** against the Dataverse **TDS/SQL endpoint**. Table and column names
are Dataverse **logical names**, which ARE the SQL table/column names on that endpoint.

```sql
SELECT TOP (5) name AS label, estimatedvalue AS value
FROM opportunity
ORDER BY createdon DESC;
```

Notes that save time:
- Prefer returning friendly columns (e.g. a category `label` + numeric `value`) so downstream widget
  code stays trivial.
- State columns are ints: `statecode` on `opportunity` is `0=Open, 1=Won, 2=Lost`.
- Aggregates with no `FROM` are fine for smoke tests: `SELECT 1 AS label, 1 AS value`.
- Use `describe` (or a `SELECT TOP 1 *`) to discover columns before guessing.

## Creating supporting tables for a demo

Use `create_table` to stand up a hosting table for the PCF (a dataset control is hosted full-page as a
table's grid — the dataset itself is ignored, it's just a host surface) or any demo-specific data.

**Publisher-prefix gotcha:** `create_table` uses the **environment's default publisher prefix**
(often `cr19f`), which is usually **not** the `--publisher-prefix` you push the PCF with (e.g. `ddb`).
So a table you ask for as `dashboard` is created as **`cr19f_dashboard`**. Always check the returned
logical name and use *that* everywhere afterward (the PCF grid binding, `--table` for
`bind-grid.mjs`, entitylist URLs). Don't assume your PCF prefix.

Minimal hosting-table recipe:
1. `create_table` with a display name (e.g. "Dashboard"); note the returned logical name
   (`<envprefix>_dashboard`).
2. Bind your PCF as its read-only grid control — see the **pcf-develop-deploy** skill (`bind-grid.mjs`);
   pass the *returned* logical name as `--table`.
3. Add a **Dashboard** sitemap page pointing at that table so it's reachable in the app.

## Writing

`create_record` / `update_record` / `delete_record` mutate rows. For demos that need seed data, create
records after the table exists. Keep destructive operations (`delete_table`) deliberate.

See also: **pcf-develop-deploy** (binding the control to the table you create here).
