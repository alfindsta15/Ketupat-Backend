import type { Context } from "hono";
import { ZodError } from "zod";
import { HttpError } from "../lib/http";
import { logger } from "../utils/logger";

export { HttpError };

export function notFoundHandler(c: Context) {
  return c.json({ message: `Route not found: ${c.req.method} ${new URL(c.req.url).pathname}` }, 404);
}

export function errorHandler(err: unknown, c: Context) {
  const path = new URL(c.req.url).pathname;

  if (err instanceof ZodError) {
    return c.json({ message: "Validation error", errors: err.flatten() }, 400);
  }

  if (err instanceof HttpError) {
    if (err.status >= 500) logger.error(err.message, { path });
    return c.json({ message: err.message }, err.status as 400);
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  logger.error("Unhandled error", { message, path, method: c.req.method });

  if (typeof err === "object" && err !== null && "code" in err && (err as any).code === "P2025") {
    return c.json({ message: "Record not found" }, 404);
  }

  return c.json({ message: "Internal server error" }, 500);
}
