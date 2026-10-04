import { isProduction } from "../config/env";

// Field yang tidak boleh masuk log, bahkan tanpa sengaja.
const SENSITIVE_KEYS = [
  "fonnte_token",
  "fonntetoken",
  "token",
  "password",
  "passwordhash",
  "jwt_secret",
  "jwtsecret",
  "authorization",
  "database_url",
  "secret",
];

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEYS.includes(key.toLowerCase()) ? "[REDACTED]" : redact(val);
    }
    return result;
  }
  return value;
}

type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, message: string, meta?: Record<string, unknown>) {
  if (level === "debug" && isProduction()) return;
  const line = meta && Object.keys(meta).length ? `${message} ${JSON.stringify(redact(meta))}` : message;
  // Workers Logs / `wrangler tail` menangkap console.*
  console[level === "debug" ? "log" : level](`[${level.toUpperCase()}] ${line}`);
}

/** API sama seperti winston sebelumnya (logger.info/warn/error/debug(message, meta)). */
export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
};

