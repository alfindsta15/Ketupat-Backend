import { createMiddleware } from "hono/factory";
import { env } from "../config/env";

/**
 * Rate limiter sederhana (fixed window) di memori isolate Worker.
 *
 * CATATAN: memori Workers tidak dibagi antar isolate/lokasi, jadi ini hanya perlindungan
 * "seadanya" (cukup menahan tekanan ringan). Untuk perlindungan ketat pasang aturan
 * Rate Limiting di dashboard Cloudflare (Security -> WAF -> Rate limiting rules).
 */
interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

function clientKey(req: Request, name: string) {
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return `${name}:${ip}`;
}

function getBucket(key: string, windowMs: number): Bucket {
  const now = Date.now();
  if (buckets.size > 2000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  return b;
}

function limiter(opts: { name: string; windowMs: () => number; max: () => number; message?: string; failuresOnly?: boolean }) {
  return createMiddleware(async (c, next) => {
    const bucket = getBucket(clientKey(c.req.raw, opts.name), opts.windowMs());
    if (bucket.count >= opts.max()) {
      const retry = Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
      c.header("Retry-After", String(retry));
      return c.json({ message: opts.message ?? "Terlalu banyak permintaan, coba lagi sebentar lagi." }, 429);
    }
    if (!opts.failuresOnly) bucket.count++;
    await next();
    // Mode "hanya gagal": login sukses tidak dihitung.
    if (opts.failuresOnly && c.res.status >= 400 && c.res.status !== 429) bucket.count++;
  });
}

/** Limiter API umum. */
export const apiRateLimiter = limiter({ name: "api", windowMs: () => env.rateLimit.windowMs, max: () => env.rateLimit.max });

/** Limiter login: hanya percobaan GAGAL yang dihitung (10x / 15 menit). */
export const loginRateLimiter = limiter({
  name: "login",
  windowMs: () => 15 * 60 * 1000,
  max: () => 10,
  failuresOnly: true,
  message: "Terlalu banyak percobaan login. Coba lagi dalam 15 menit.",
});

/** Webhook bisa menerima burst trafik sah; longgar tapi tetap dibatasi. */
export const webhookRateLimiter = limiter({ name: "webhook", windowMs: () => 60 * 1000, max: () => 300 });
