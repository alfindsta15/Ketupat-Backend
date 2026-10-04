import crypto from "node:crypto";
import { env } from "../config/env";

/**
 * Link khusus upload untuk customer, mis.:
 *   https://ketupat.vercel.app/upload/12-3fa9c01b77d2e4a85c10
 *
 * Token = "<orderId>-<HMAC>" (stateless, tidak butuh tabel baru / migrasi DB).
 * HMAC memakai JWT_SECRET sehingga tidak bisa ditebak/dipalsukan. Link hanya
 * berlaku untuk 1 order dan otomatis tidak bisa dipakai lagi bila order
 * sudah SELESAI / DIBATALKAN (dicek di public.controller).
 */
const SIG_LENGTH = 20;

function sign(orderId: number): string {
  return crypto
    .createHmac("sha256", env.jwtSecret)
    .update(`upload:${orderId}`)
    .digest("hex")
    .slice(0, SIG_LENGTH);
}

export function createUploadToken(orderId: number): string {
  return `${orderId}-${sign(orderId)}`;
}

/** Mengembalikan orderId bila token valid, selain itu null. */
export function parseUploadToken(token: string): number | null {
  const match = /^(\d{1,9})-([a-f0-9]{20})$/.exec(token ?? "");
  if (!match) return null;
  const orderId = Number(match[1]);
  const expected = Buffer.from(sign(orderId));
  const given = Buffer.from(match[2]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return orderId;
}

/** URL halaman upload di frontend. Pastikan FRONTEND_URL (wrangler.toml) = domain Vercel. */
export function buildUploadUrl(orderId: number): string {
  // FRONTEND_URL boleh berisi beberapa domain (dipisah koma); link upload memakai yang pertama.
  const base = env.frontendUrl.split(",")[0].trim().replace(/\/$/, "");
  return `${base}/upload/${createUploadToken(orderId)}`;
}
