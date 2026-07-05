/**
 * Central configuration, loaded from `.env` (see .env.example).
 * Secrets are never logged directly — use configSummary() for a redacted view.
 */
import "dotenv/config";

const num = (v: string | undefined, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};
const trimSlash = (v: string) => v.replace(/\/+$/, "");

const port = num(process.env.PORT, 3101);

export const config = {
  port,
  // The HTTPS base the PCF (and any served component pages) reach the server at. MUST equal the PCF's
  // `serverBaseUrl` property AND the manifest `external-service-usage` domain. `http://localhost` is
  // silently blocked as mixed content inside the HTTPS Power App — run behind an HTTPS devtunnel and
  // set this to that base (see the bridge-troubleshooting skill).
  publicBaseUrl: trimSlash(process.env.PUBLIC_BASE_URL || `http://localhost:${port}`),

  // Capability token gating GET /state (the shared-state read). Long-lived; keep it out of source.
  stateKey: process.env.STATE_KEY || "",

  // Space-separated CSP frame-ancestors allowed to iframe any component pages the server serves (for
  // demos that add framed components). Lock to the org host in production.
  frameAncestors: process.env.FRAME_ANCESTORS || "https://*.dynamics.com 'self'",

  stateFile: process.env.STATE_FILE || "state.json",
  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase() as "error" | "warn" | "info" | "debug",
  logDir: process.env.LOG_DIR || "logs",
};

export type Config = typeof config;

/** Throw a clear error if any required config key is empty. */
export function requireConfig(keys: (keyof Config)[]): void {
  const missing = keys.filter((k) => !config[k]);
  if (missing.length) {
    throw new Error(`Missing required config: ${missing.join(", ")}. Set them in mcp-server/.env`);
  }
}

/** Redacted, log-safe view of the effective configuration. */
export function configSummary(): Record<string, unknown> {
  const s = (v: string) => (v ? "set" : "MISSING");
  return {
    port: config.port,
    publicBaseUrl: config.publicBaseUrl,
    stateKey: s(config.stateKey),
    logLevel: config.logLevel,
  };
}
