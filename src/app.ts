import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "./types";
import { allowedOrigins } from "./config/env";
import apiRoutes from "./routes";
import { receiveFonnteWebhook } from "./controllers/webhook.controller";
import { apiRateLimiter, webhookRateLimiter } from "./middleware/rateLimit.middleware";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { UPLOAD_DIRS } from "./lib/storage";

/** Cocokkan origin dengan daftar FRONTEND_URL (mendukung wildcard, mis. https://*.vercel.app). */
function originAllowed(origin: string): boolean {
  return allowedOrigins().some((rule) => {
    if (!rule.includes("*")) return rule === origin;
    const re = new RegExp("^" + rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+") + "$");
    return re.test(origin);
  });
}

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", secureHeaders({ crossOriginResourcePolicy: "cross-origin" }));

  app.use(
    "/api/*",
    cors({
      origin: (origin) => (origin && originAllowed(origin) ? origin : ""),
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 86400,
    })
  );

  app.get("/health", (c) => c.json({ status: "ok", service: "ketupat-backend", runtime: "cloudflare-workers" }));

  // File upload (QRIS, bukti bayar, referensi, hasil) disajikan dari R2 pada path yang sama seperti dulu.
  app.on(["GET", "HEAD"], "/uploads/*", async (c) => {
    const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/uploads\//, ""));
    const [dir, name, ...rest] = key.split("/");
    if (rest.length || !name || !(UPLOAD_DIRS as readonly string[]).includes(dir) || !/^[A-Za-z0-9._-]+$/.test(name)) {
      return c.json({ message: "Not found" }, 404);
    }
    const object = await c.env.UPLOADS.get(key);
    if (!object) return c.json({ message: "File tidak ditemukan" }, 404);

    const headers = new Headers();
    object.writeHttpMetadata(headers as any);
    headers.set("etag", object.httpEtag);
    headers.set("Cache-Control", "public, max-age=86400");
    return new Response(c.req.method === "HEAD" ? null : (object.body as any), { headers });
  });

  app.post("/webhook/fonnte", webhookRateLimiter, receiveFonnteWebhook);

  app.use("/api/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  app.use("/api/*", apiRateLimiter);
  app.route("/api", apiRoutes);

  app.notFound(notFoundHandler);
  app.onError(errorHandler);

  return app;
}
