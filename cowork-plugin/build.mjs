/**
 * Package + validate the Cowork chess plugin:
 *   1. substitute PUBLIC_BASE_URL (from mcp-server/.env) into manifest.template.json
 *   2. validate the package — structural checks (required fields, icon sizes, skill frontmatter) always;
 *      full JSON-schema validation against the manifest's own $schema URL (fetched live; the devPreview
 *      schema is not redistributable-fresh anywhere offline). `--schema <path|url>` overrides the source;
 *      offline → loud warning, structural checks still gate the build.
 *   3. zip { manifest.json, icons, skills/ } into dist/cowork-chess-plugin.zip
 * Run via `npm run package:cowork` in mcp-server/ (adm-zip + ajv are devDependencies there).
 * Re-run + re-upload the zip whenever the devtunnel URL changes.
 */
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = resolve(HERE, "..", "mcp-server", ".env");
const OUT_DIR = resolve(HERE, "dist");
const OUT_ZIP = resolve(OUT_DIR, "cowork-chess-plugin.zip");

// deps live in mcp-server/node_modules (this script is wired through mcp-server's npm).
const require = createRequire(pathToFileURL(resolve(HERE, "..", "mcp-server", "package.json")));
const AdmZip = require("adm-zip");

const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
  return cond;
}
function fail(msg) {
  console.error(`package:cowork FAILED — ${msg}`);
  process.exit(1);
}

// --- 1. PUBLIC_BASE_URL from mcp-server/.env (tiny KEY=value parse; no dependency needed) -----------
let env = "";
try {
  env = readFileSync(ENV_FILE, "utf-8");
} catch {
  fail(`cannot read ${ENV_FILE} — create it with PUBLIC_BASE_URL=https://<your-devtunnel-base>`);
}
const m = /^\s*PUBLIC_BASE_URL\s*=\s*"?([^"\r\n]+?)"?\s*$/m.exec(env);
const baseUrl = m?.[1]?.trim().replace(/\/+$/, "");
if (!baseUrl) fail(`PUBLIC_BASE_URL not set in ${ENV_FILE}`);
if (!/^https:\/\//i.test(baseUrl) || /localhost|127\.0\.0\.1/i.test(baseUrl)) {
  fail(`PUBLIC_BASE_URL is "${baseUrl}" — Cowork needs a public HTTPS URL (anonymous devtunnel), not localhost/http`);
}

const template = readFileSync(resolve(HERE, "manifest.template.json"), "utf-8");
const manifestText = template.replaceAll("{{PUBLIC_BASE_URL}}", baseUrl);

// --- 2a. structural validation (offline, always gates the build) ------------------------------------
check(!manifestText.includes("{{"), "unreplaced {{placeholder}} left in manifest");
let manifest;
try {
  manifest = JSON.parse(manifestText);
} catch (e) {
  fail(`substituted manifest is not valid JSON: ${e.message}`);
}
for (const key of ["manifestVersion", "version", "id", "developer", "name", "description", "icons", "accentColor"]) {
  check(manifest[key] !== undefined, `manifest is missing required field "${key}"`);
}
check(manifest.manifestVersion === "devPreview", 'manifestVersion must be "devPreview" (agentSkills/agentConnectors)');
check(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(manifest.id ?? ""),
  "manifest.id must be a GUID",
);
const connectors = manifest.agentConnectors ?? [];
check(connectors.length > 0, "manifest has no agentConnectors");
for (const c of connectors) {
  const url = c.toolSource?.remoteMcpServer?.mcpServerUrl ?? "";
  check(/^https:\/\//.test(url), `connector "${c.id}": mcpServerUrl must be https (got "${url}")`);
  check(!!c.toolSource?.remoteMcpServer?.authorization?.type, `connector "${c.id}": authorization.type missing`);
}

function pngSize(path) {
  const b = readFileSync(path);
  const ok = b.length > 24 && b.readUInt32BE(0) === 0x89504e47; // \x89PNG
  return ok ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null;
}
const color = pngSize(resolve(HERE, manifest.icons?.color ?? "color.png"));
const outline = pngSize(resolve(HERE, manifest.icons?.outline ?? "outline.png"));
check(color?.w === 192 && color?.h === 192, `color.png must be a 192×192 PNG (got ${color ? `${color.w}×${color.h}` : "not a PNG"})`);
check(outline?.w === 32 && outline?.h === 32, `outline.png must be a 32×32 PNG (got ${outline ? `${outline.w}×${outline.h}` : "not a PNG"})`);

for (const s of manifest.agentSkills ?? []) {
  const folder = s.folder?.replace(/^\.\//, "") ?? "";
  let md = "";
  try {
    md = readFileSync(resolve(HERE, folder, "SKILL.md"), "utf-8");
  } catch {
    check(false, `agentSkills folder "${s.folder}" has no SKILL.md`);
    continue;
  }
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  check(!!fm, `${folder}/SKILL.md has no YAML frontmatter`);
  if (fm) {
    check(/^name:\s*\S/m.test(fm[1]), `${folder}/SKILL.md frontmatter is missing "name"`);
    check(/^description:\s*\S/m.test(fm[1]), `${folder}/SKILL.md frontmatter is missing "description"`);
  }
}

// --- 2b. JSON-schema validation against the manifest's $schema (live fetch or --schema override) ----
async function loadSchema() {
  const argIdx = process.argv.indexOf("--schema");
  const source = argIdx >= 0 ? process.argv[argIdx + 1] : manifest.$schema;
  if (!source) return { skipped: "manifest has no $schema and no --schema given" };
  try {
    if (/^https?:\/\//.test(source)) {
      const res = await fetch(source, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { schema: await res.json(), source };
    }
    return { schema: JSON.parse(readFileSync(resolve(source), "utf-8")), source };
  } catch (e) {
    return { skipped: `could not load schema from ${source}: ${e.message}` };
  }
}

const { schema, source, skipped } = await loadSchema();
if (skipped) {
  console.warn(`WARNING: schema validation SKIPPED — ${skipped}`);
  console.warn("         (structural checks still ran; re-run online or pass --schema <path|url> to fully validate)");
} else {
  // The hosted Teams schemas have been draft-04 historically; pick the Ajv build that matches.
  const draft = String(schema.$schema ?? "");
  const Ajv = draft.includes("draft-04") ? require("ajv-draft-04") : require("ajv");
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  const validate = ajv.compile(schema);
  if (!validate(manifest)) {
    for (const err of validate.errors ?? []) {
      failures.push(`schema: ${err.instancePath || err.dataPath || "/"} ${err.message}`);
    }
  } else {
    console.log(`schema validation OK (${source})`);
  }
}

if (failures.length) {
  console.error("package:cowork FAILED — validation errors:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

// --- 3. zip flat at the package root (Teams app-package layout) -------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
const zip = new AdmZip();
zip.addFile("manifest.json", Buffer.from(manifestText, "utf-8"));
zip.addLocalFile(resolve(HERE, "color.png"));
zip.addLocalFile(resolve(HERE, "outline.png"));
zip.addLocalFile(resolve(HERE, "skills", "play-chess", "SKILL.md"), "skills/play-chess");
zip.writeZip(OUT_ZIP);

console.log(`wrote ${OUT_ZIP}`);
console.log(`mcpServerUrl: ${baseUrl}/mcp`);
console.log("Next: sideload the zip (M365 Admin Center → upload custom app), enable it in Cowork Sources & Skills.");
