#!/usr/bin/env node
/**
 * bind-grid.mjs — bind a PCF dataset control as the read-only GRID control of a Dataverse table,
 * WITHOUT hand-editing customization XML and WITHOUT the (brittle) classic "Add control" picker.
 *
 * Why this exists
 * ---------------
 * The classic customization UI will not list a PCF *dataset* control in its control picker, so a
 * dataset control can't be bound to a table's grid the "normal" way. The reliable path is a solution
 * round-trip: export a solution containing the table, inject a <CustomControlDefaultConfig> for the
 * control on ALL THREE form factors (0/1/2) with its static input-property values, then import with
 * --publish-changes. Import regenerates `controldescriptionjson` from the XML — patching XML alone
 * (e.g. a raw update_record) leaves stale JSON and the control won't render. The classic UI still shows
 * "no custom control" afterward; that UI is an unreliable mirror — runtime is the source of truth.
 *
 * What it does
 * ------------
 *   1. Export an unmanaged solution that contains the target table (pass --solution, or use
 *      --create-solution to have the script make a temp one and add the table).
 *   2. Unpack it (pac solution unpack).
 *   3. Inject/replace <CustomControlDefaultConfigs> on the table's <Entity> in customizations.xml,
 *      with <customControl> for formFactor 0, 1 and 2, the <data-set>, and each static property.
 *   4. Repack and import with --publish-changes.
 *   5. Print the entitylist URL to verify at runtime.
 *
 * Prerequisites: `pac` CLI authenticated to the target env (`pac auth create --url <env>`); the table
 * exists. This wraps `pac solution` on purpose — the interactive dev identity already carries the maker
 * privileges the operation needs (a separate Web-API app registration would need extra setup).
 *
 * Usage:
 *   node bind-grid.mjs \
 *     --env https://org.crm.dynamics.com \
 *     --table cr19f_dashboard \
 *     --control cr19f_Bridge.SmokeTestPanel \        # <prefix>_<Namespace>.<Constructor>
 *     --dataset bridgeGrid \                         # MUST equal the manifest's <data-set name>

 *     --publisher-prefix cr19f \                     # only needed with --create-solution
 *     --solution MyExistingSolution \               # OR: --create-solution
 *     --prop serverBaseUrl=https://xxxx-3101.euw.devtunnels.ms \
 *     --prop agentId=T_00000000-0000-0000-0000-000000000000 \
 *     --prop stateKey=some-capability-key \
 *     --prop autoRefreshSeconds=30
 *
 * Property types default to SingleLine.Text; pass `--prop name=value:Whole.None` to override the type
 * (e.g. autoRefreshSeconds=30:Whole.None).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------- arg parsing ----------------------------------------------------
function parseArgs(argv) {
  const out = { prop: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (key === "create-solution") { out.createSolution = true; continue; }
    const val = argv[++i];
    if (key === "prop") out.prop.push(val);
    else out[key] = val;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const required = ["env", "table", "control", "dataset"];
for (const r of required) {
  if (!args[r]) fail(`Missing --${r}. See the header comment for usage.`);
}
if (!args.solution && !args.createSolution) {
  fail("Provide --solution <existingUnmanagedSolutionContainingTheTable>, or --create-solution --publisher-prefix <p>.");
}

// Parse "name=value" or "name=value:Type" property specs.
const props = args.prop.map((spec) => {
  const eq = spec.indexOf("=");
  if (eq < 0) fail(`Bad --prop "${spec}" (expected name=value).`);
  const name = spec.slice(0, eq);
  let value = spec.slice(eq + 1);
  let type = "SingleLine.Text";
  const colon = value.lastIndexOf(":");
  if (colon > 0 && /^[A-Za-z.]+$/.test(value.slice(colon + 1))) {
    type = value.slice(colon + 1);
    value = value.slice(0, colon);
  }
  return { name, value, type };
});

// ---------- helpers --------------------------------------------------------
function fail(msg) { console.error(`\n✖ bind-grid: ${msg}\n`); process.exit(1); }
// On Windows the CLI is `pac.cmd`, which Node cannot spawn without a shell (CreateProcess can't run
// a batch file directly). Use the .cmd name + shell there; plain `pac` + no shell elsewhere.
const IS_WIN = process.platform === "win32";
const PAC = IS_WIN ? "pac.cmd" : "pac";
function pac(subargs) {
  console.error(`→ pac ${subargs.join(" ")}`);
  return execFileSync(PAC, subargs, { stdio: ["ignore", "inherit", "inherit"], shell: IS_WIN });
}
function xmlEscape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Build the <ControlDescriptionXML> value: one <customControl> per form factor (0/1/2).
function controlDescriptionXml() {
  const params =
    `<data-set name="${xmlEscape(args.dataset)}"><columnsDefaultView /></data-set>` +
    props
      .map((p) => `<${p.name} static="true" type="${p.type}">${xmlEscape(p.value)}</${p.name}>`)
      .join("");
  const one = (ff) =>
    `<customControl formFactor="${ff}" name="${xmlEscape(args.control)}"><parameters>${params}</parameters></customControl>`;
  return `<controlDescriptions><controlDescription>${one(0)}${one(1)}${one(2)}</controlDescription></controlDescriptions>`;
}

// The full <CustomControlDefaultConfigs> block to slot into the table's <Entity>.
function customControlConfigsBlock() {
  return (
    `<CustomControlDefaultConfigs>` +
    `<CustomControlDefaultConfig>` +
    `<ControlDescriptionXML>${controlDescriptionXml()}</ControlDescriptionXML>` +
    `<IntroducedVersion>1.0</IntroducedVersion>` +
    `</CustomControlDefaultConfig>` +
    `</CustomControlDefaultConfigs>`
  );
}

// Inject/replace <CustomControlDefaultConfigs> on the <Entity> whose <Name>…</Name> === table.
function patchCustomizations(xml) {
  const table = args.table;
  // Find the <Entity> block whose <Name ...>table</Name> matches (case-insensitive).
  const entityRe = /<Entity>[\s\S]*?<\/Entity>/g;
  let match, target = null;
  while ((match = entityRe.exec(xml))) {
    const block = match[0];
    const name = /<Name[^>]*>([^<]+)<\/Name>/i.exec(block);
    if (name && name[1].trim().toLowerCase() === table.toLowerCase()) { target = { block, index: match.index }; break; }
  }
  if (!target) fail(`Could not find <Entity> for table "${table}" in the exported customizations.xml. ` +
    `Is the table in the solution? (use --create-solution to add it automatically).`);

  let block = target.block;
  const configs = customControlConfigsBlock();
  if (/<CustomControlDefaultConfigs\s*\/?>/.test(block)) {
    // Replace an existing (possibly self-closed or populated) block.
    block = block.replace(/<CustomControlDefaultConfigs[\s\S]*?<\/CustomControlDefaultConfigs>|<CustomControlDefaultConfigs\s*\/>/, configs);
  } else {
    // Insert right before </Entity>.
    block = block.replace(/<\/Entity>\s*$/, `${configs}</Entity>`);
  }
  return xml.slice(0, target.index) + block + xml.slice(target.index + target.block.length);
}

// Modern pac (>= ~2.x) splits each table into its own Entities/<table>/Entity.xml with an inner
// <entity Name="…">…</entity>; CustomControlDefaultConfigs is a child of that <entity>. (Older pac
// inlined the <Entity> in customizations.xml — patchCustomizations() handles that fallback.)
function entityXmlPath(dir, table) {
  const entitiesDir = join(dir, "Entities");
  if (!existsSync(entitiesDir)) return null;
  for (const e of readdirSync(entitiesDir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.toLowerCase() === table.toLowerCase()) {
      const p = join(entitiesDir, e.name, "Entity.xml");
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function patchEntityXml(xml) {
  const configs = customControlConfigsBlock();
  const existing = /<CustomControlDefaultConfigs[\s\S]*?<\/CustomControlDefaultConfigs>|<CustomControlDefaultConfigs\s*\/>/;
  if (existing.test(xml)) return xml.replace(existing, configs);
  // CustomControlDefaultConfigs is a child of the OUTER <Entity> — a sibling of <FormXml>/<SavedQueries>/
  // <RibbonDiffXml>, right before </Entity> — NOT a child of the inner <entity Name="…">. This mirrors
  // how Dataverse itself exports a grid-control binding; putting it inside <entity> makes import drop it.
  if (!/<\/Entity>\s*$/.test(xml)) fail("No trailing </Entity> in Entity.xml — unexpected solution format.");
  return xml.replace(/<\/Entity>\s*$/, `${configs}</Entity>`);
}

function findCustomizationsXml(dir) {
  // pac solution unpack writes customizations.xml at the unpack root.
  const direct = join(dir, "customizations.xml");
  if (existsSync(direct)) return direct;
  // Fallback: search one level down.
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const p = join(dir, e.name, "customizations.xml");
      if (existsSync(p)) return p;
    }
  }
  fail(`customizations.xml not found under ${dir}.`);
}

// ---------- main -----------------------------------------------------------
const work = mkdtempSync(join(tmpdir(), "bindgrid-"));
const exportZip = join(work, "solution.zip");
const unpackDir = join(work, "unpacked");
const repackZip = join(work, "solution-patched.zip");
let solutionName = args.solution;

console.error(`bind-grid: binding ${args.control} as the grid control of ${args.table}`);
console.error(`  workdir: ${work}`);

// (Optional) create a temp solution and add the table to it.
if (args.createSolution) {
  if (!args["publisher-prefix"]) fail("--create-solution requires --publisher-prefix <prefix>.");
  solutionName = `BindGridTemp${Date.now().toString().slice(-6)}`;
  const projDir = join(work, "proj");
  pac(["solution", "init", "--publisher-name", "bindgrid", "--publisher-prefix", args["publisher-prefix"], "--outputDirectory", projDir]);
  // `pac solution init` derives the solution's UniqueName from the scaffold, not from us — force ours
  // so the add-solution-component / export calls below resolve.
  const solXml = join(projDir, "src", "Other", "Solution.xml");
  writeFileSync(solXml, readFileSync(solXml, "utf8").replace(/<UniqueName>[^<]*<\/UniqueName>/, `<UniqueName>${solutionName}</UniqueName>`));
  // Pack + import the empty solution to create it in the org, then add the table as a component.
  // NB: the packable solution layout lives under src/ in an init scaffold.
  pac(["solution", "pack", "--zipfile", join(work, "empty.zip"), "--folder", join(projDir, "src"), "--packagetype", "Unmanaged"]);
  pac(["solution", "import", "--path", join(work, "empty.zip"), "--force-overwrite", "--publish-changes"]);
  // Entity componentType = 1. --component expects the metadata id; many pac builds also accept the
  // logical name here. If your pac rejects the name, look up the entity's MetadataId first.
  pac(["solution", "add-solution-component", "--solutionUniqueName", solutionName,
    "--component", args.table, "--componentType", "1", "--AddRequiredComponents", "false"]);
}

// 1. Export the (existing or just-created) solution containing the table.
pac(["solution", "export", "--name", solutionName, "--path", exportZip, "--managed", "false", "--overwrite", "true"]);

// 2. Unpack.
pac(["solution", "unpack", "--zipfile", exportZip, "--folder", unpackDir, "--packagetype", "Unmanaged", "--allowDelete", "true"]);

// 3. Patch the table's customization XML. Modern pac splits each table into
//    Entities/<table>/Entity.xml; older pac inlined <Entity> in customizations.xml. Handle both.
const entityPath = entityXmlPath(unpackDir, args.table);
if (entityPath) {
  writeFileSync(entityPath, patchEntityXml(readFileSync(entityPath, "utf8")));
  console.error(`✓ patched ${entityPath}`);
} else {
  const custPath = findCustomizationsXml(unpackDir);
  writeFileSync(custPath, patchCustomizations(readFileSync(custPath, "utf8")));
  console.error(`✓ patched ${custPath}`);
}

// 4. Repack + import with publish (import regenerates controldescriptionjson from the XML).
pac(["solution", "pack", "--zipfile", repackZip, "--folder", unpackDir, "--packagetype", "Unmanaged"]);
pac(["solution", "import", "--path", repackZip, "--force-overwrite", "--publish-changes"]);

// 5. Verify at runtime (the classic UI will lie — open the grid directly).
const host = args.env.replace(/\/+$/, "");
console.error(`\n✓ Bound. The classic customization UI may still show "no custom control" — that mirror is unreliable.`);
console.error(`  Verify at runtime by opening the table grid:`);
console.error(`  ${host}/main.aspx?pagetype=entitylist&etn=${args.table}\n`);
