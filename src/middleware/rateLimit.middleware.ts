import rateLimit from "express-rate-limit";
import { env } from "../config/env";

/** General API rate limiter. */
export const apiRateLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Terlalu banyak permintaan, coba lagi sebentar lagi." },
});

/**
 * Limiter login. Hanya percobaan GAGAL yang dihitung (skipSuccessfulRequests),
 * jadi admin yang login normal tidak pernah terkena limit.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: "Terlalu banyak percobaan login. Coba lagi dalam 15 menit." },
});

/** Webhook can receive bursts of legitimate traffic; keep generous but bounded. */
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
