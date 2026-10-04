import type { ExecutionContext } from "@cloudflare/workers-types";
import { createApp } from "./app";
import { Bindings, initEnv } from "./config/env";
import { requestContext, RequestStore } from "./lib/context";
import { setBindings } from "./lib/bindings";
import { createPrismaClient, PrismaClient } from "./lib/prisma";
import { logger } from "./utils/logger";

const app = createApp();

export default {
  async fetch(request: Request, bindings: Bindings, ctx: ExecutionContext): Promise<Response> {
    initEnv(bindings, request.url);
    setBindings(bindings);

    const path = new URL(request.url).pathname;
    const needsAuthSecret = path.startsWith("/api/") || path.startsWith("/webhook/");
    if (needsAuthSecret && (!bindings.JWT_SECRET || bindings.JWT_SECRET.length < 16)) {
      return Response.json(
        { message: "Server belum dikonfigurasi: JWT_SECRET kosong/terlalu pendek (jalankan `wrangler secret put JWT_SECRET`)." },
        { status: 500 }
      );
    }

    // PrismaClient dibuat malas (lazy): request tanpa DB (mis. /health, file R2) tidak membuka koneksi.
    let client: PrismaClient | undefined;
    const store: RequestStore = {
      getPrisma: () => (client ??= createPrismaClient(bindings)),
      tasks: [],
      ctx,
    };

    return requestContext.run(store, async () => {
      try {
        return await app.fetch(request, bindings, ctx);
      } finally {
        // Tutup koneksi setelah semua pekerjaan latar (webhook) selesai.
        ctx.waitUntil(
          Promise.allSettled(store.tasks)
            .then(() => client?.$disconnect())
            .catch((err) => logger.error("Gagal menutup koneksi database", { error: String(err) }))
        );
      }
    });
  },
};
