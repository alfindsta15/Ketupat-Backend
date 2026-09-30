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

/** Stricter limiter for the admin login endpoint to slow down brute force attempts. */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Terlalu banyak percobaan login. Coba lagi dalam 15 menit." },
});

/** Webhook can receive bursts of legitimate traffic; keep generous but bounded. */
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
