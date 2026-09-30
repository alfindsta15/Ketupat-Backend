import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { env } from "./config/env";
import apiRoutes from "./routes";
import webhookRoutes from "./routes/webhook.routes";
import { apiRateLimiter } from "./middleware/rateLimit.middleware";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { logger } from "./utils/logger";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");

  // Security headers. We relax cross-origin-resource-policy so uploaded
  // images (QRIS/proof/result files) can be fetched by the frontend and by
  // the WhatsApp gateway when generating link previews.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  app.use(
    cors({
      origin: env.frontendUrl,
      credentials: true,
    })
  );

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  // Publicly serve uploaded files (QRIS image, payment proofs, result files).
  // Fonnte needs these to be reachable via a public URL to attach/display them.
  app.use("/uploads", express.static(env.uploadDir));

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "ketupat-backend" }));

  // Fonnte webhook is intentionally outside the general API rate limiter
  // (it has its own, more permissive limiter) and outside admin auth.
  app.use("/webhook", webhookRoutes);

  app.use("/api", apiRateLimiter, apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.info("Express app initialized", { env: env.nodeEnv });

  return app;
}
