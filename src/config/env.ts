import "dotenv/config";
import path from "path";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    // We don't throw for FONNTE_TOKEN at import time because some scripts
    // (like running unit tests) don't need it. fonnte.service.ts checks
    // for it lazily right before making a real request.
    if (name === "FONNTE_TOKEN") return "";
    throw new Error(`[env] Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:4000",
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",

  databaseUrl: required("DATABASE_URL", "file:./dev.db"),

  jwtSecret: required("JWT_SECRET", "dev-only-insecure-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",

  seedAdmin: {
    name: process.env.SEED_ADMIN_NAME ?? "Admin KETUPAT",
    email: process.env.SEED_ADMIN_EMAIL ?? "admin@ketupat.id",
    password: process.env.SEED_ADMIN_PASSWORD ?? "ketupat123",
  },

  fonnte: {
    token: required("FONNTE_TOKEN", ""),
    baseUrl: process.env.FONNTE_BASE_URL ?? "https://api.fonnte.com",
    webhookSecret: process.env.FONNTE_WEBHOOK_SECRET ?? "",
  },

  // WhatsApp number of the real human admin, used only to ping them when a
  // customer asks for a free "Konsultasi" (no order/payment involved) so
  // they can jump into the chat personally. Optional: leave blank to disable.
  adminWhatsappNumber: process.env.ADMIN_WHATSAPP_NUMBER ?? "",

  // Optional WEBP sticker URLs sent alongside a few key bot messages for
  // extra flair. Leave any of these blank to skip sending a sticker there.
  stickers: {
    orderCreated: process.env.STICKER_ORDER_CREATED_URL ?? "",
    paymentVerified: process.env.STICKER_PAYMENT_VERIFIED_URL ?? "",
    completed: process.env.STICKER_COMPLETED_URL ?? "",
  },

  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "uploads"),
  maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE_MB ?? 5),

  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000),
    max: Number(process.env.RATE_LIMIT_MAX ?? 120),
  },
};

export const isProduction = env.nodeEnv === "production";
