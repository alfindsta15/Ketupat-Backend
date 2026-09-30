import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import apiRoutes from "./routes";
import webhookRoutes from "./routes/webhook.routes";
import { apiRateLimiter } from "./middleware/rateLimit.middleware";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { logger } from "./utils/logger";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");

  // PENTING: backend berjalan di belakang proxy (Vercel rewrite + Back4app).
  // Tanpa ini, semua request terlihat berasal dari 1 IP yang sama, sehingga
  // rate limiter (login 10x/15 menit, API 120x/menit) dipakai BERSAMA dan
  // bisa membuat /auth/me gagal -> admin terlempar ke halaman login.
  app.set("trust proxy", 1);

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

  app.use("/uploads", express.static(env.uploadDir));

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "ketupat-backend" }));

  app.use("/webhook", webhookRoutes);

  app.use("/api", apiRateLimiter, apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.info("Express app initialized", { env: env.nodeEnv });

  return app;
}
