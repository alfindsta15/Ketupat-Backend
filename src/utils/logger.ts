import winston from "winston";
import { isProduction } from "../config/env";

// Fields that must never end up in logs, even by accident.
const SENSITIVE_KEYS = [
  "fonnte_token",
  "fonntetoken",
  "token",
  "password",
  "passwordhash",
  "jwt_secret",
  "jwtsecret",
  "authorization",
];

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redact(val);
      }
    }
    return result;
  }

  return value;
}

const redactFormat = winston.format((info) => {
  const cloned = { ...info };
  for (const key of Object.keys(cloned)) {
    if (key === "level" || key === "message" || key === "timestamp") continue;
    (cloned as any)[key] = redact((cloned as any)[key]);
  }
  return cloned;
});

export const logger = winston.createLogger({
  level: isProduction ? "info" : "debug",
  format: winston.format.combine(
    redactFormat(),
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
      return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});
