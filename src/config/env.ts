/**
 * Konfigurasi runtime untuk Cloudflare Workers.
 *
 * Di Workers tidak ada `process.env` yang dibaca saat start. Semua nilai datang dari
 * "bindings" (vars + secrets + R2 + Hyperdrive) yang dikirim runtime di setiap request.
 * `env` di bawah adalah objek singleton yang diisi ulang oleh `initEnv()` di awal request,
 * sehingga seluruh service/bot lama tetap bisa memakai `import { env } from "../config/env"`.
 */
import type { R2Bucket, Hyperdrive } from "@cloudflare/workers-types";

export interface Bindings {
  // --- binding Cloudflare ---
  UPLOADS: R2Bucket;
  HYPERDRIVE?: Hyperdrive;

  // --- secrets (wrangler secret put ...) ---
  DATABASE_URL?: string;
  JWT_SECRET?: string;
  FONNTE_TOKEN?: string;
  FONNTE_WEBHOOK_SECRET?: string;

  // --- vars biasa (wrangler.toml) ---
  NODE_ENV?: string;
  APP_BASE_URL?: string;
  FRONTEND_URL?: string;
  JWT_EXPIRES_IN?: string;
  FONNTE_BASE_URL?: string;
  ADMIN_WHATSAPP_NUMBER?: string;
  STICKER_ORDER_CREATED_URL?: string;
  STICKER_PAYMENT_VERIFIED_URL?: string;
  STICKER_COMPLETED_URL?: string;
  MAX_UPLOAD_SIZE_MB?: string;
  RATE_LIMIT_WINDOW_MS?: string;
  RATE_LIMIT_MAX?: string;
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : fallback;
};

export const env = {
  nodeEnv: "development",
  /** URL publik Worker ini (dipakai untuk link QRIS & file hasil). Default: origin request. */
  appBaseUrl: "http://localhost:8787",
  /** Domain frontend (Vercel). Boleh beberapa, pisahkan koma. Entri pertama dipakai untuk link upload. */
  frontendUrl: "http://localhost:5173",

  jwtSecret: "",
  jwtExpiresIn: "7d",

  fonnte: {
    token: "",
    baseUrl: "https://api.fonnte.com",
    webhookSecret: "",
  },

  adminWhatsappNumber: "",

  stickers: {
    orderCreated: "",
    paymentVerified: "",
    completed: "",
  },

  maxUploadSizeMb: 5,

  rateLimit: {
    windowMs: 60000,
    max: 120,
  },
};

export const isProduction = () => env.nodeEnv === "production";

/** Isi ulang `env` dari bindings request saat ini. Aman dipanggil di setiap request. */
export function initEnv(b: Partial<Bindings>, requestUrl?: string) {
  env.nodeEnv = b.NODE_ENV ?? "production";
  env.appBaseUrl = (b.APP_BASE_URL || (requestUrl ? new URL(requestUrl).origin : env.appBaseUrl)).replace(/\/$/, "");
  env.frontendUrl = b.FRONTEND_URL || "http://localhost:5173";

  env.jwtSecret = b.JWT_SECRET ?? "";
  env.jwtExpiresIn = b.JWT_EXPIRES_IN || "7d";

  env.fonnte.token = b.FONNTE_TOKEN ?? "";
  env.fonnte.baseUrl = b.FONNTE_BASE_URL || "https://api.fonnte.com";
  env.fonnte.webhookSecret = b.FONNTE_WEBHOOK_SECRET ?? "";

  env.adminWhatsappNumber = b.ADMIN_WHATSAPP_NUMBER ?? "";

  env.stickers.orderCreated = b.STICKER_ORDER_CREATED_URL ?? "";
  env.stickers.paymentVerified = b.STICKER_PAYMENT_VERIFIED_URL ?? "";
  env.stickers.completed = b.STICKER_COMPLETED_URL ?? "";

  env.maxUploadSizeMb = num(b.MAX_UPLOAD_SIZE_MB, 5);
  env.rateLimit.windowMs = num(b.RATE_LIMIT_WINDOW_MS, 60000);
  env.rateLimit.max = num(b.RATE_LIMIT_MAX, 120);
}

/** Daftar origin frontend yang diizinkan (CORS). Mendukung wildcard seperti https://*.vercel.app */
export function allowedOrigins(): string[] {
  return env.frontendUrl
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}
