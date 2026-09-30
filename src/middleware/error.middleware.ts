import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../utils/logger";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ message: "Validation error", errors: err.flatten() });
  }

  if (err instanceof HttpError) {
    if (err.status >= 500) logger.error(err.message, { path: req.path });
    return res.status(err.status).json({ message: err.message });
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  logger.error("Unhandled error", { message, path: req.path, method: req.method });

  // Prisma "record not found" style errors -> 404 instead of 500
  if (typeof err === "object" && err !== null && "code" in err && (err as any).code === "P2025") {
    return res.status(404).json({ message: "Record not found" });
  }

  return res.status(500).json({ message: "Internal server error" });
}
