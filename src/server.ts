import fs from "fs";
import { env } from "./config/env";
import { createApp } from "./app";
import { logger } from "./utils/logger";
import { prisma } from "./lib/prisma";

fs.mkdirSync("logs", { recursive: true });
["qris", "results", "incoming"].forEach((d) =>
  fs.mkdirSync(`${env.uploadDir}/${d}`, { recursive: true })
);

if (!env.fonnte.token) {
  logger.warn("FONNTE_TOKEN belum diisi di .env - pesan WhatsApp tidak akan terkirim.");
}
if (env.nodeEnv === "production" && env.jwtSecret.startsWith("dev-only")) {
  logger.error("JWT_SECRET masih default. Ganti di .env sebelum production!");
  process.exit(1);
}

const app = createApp();
const server = app.listen(env.port, () => {
  logger.info(`KETUPAT backend running on port ${env.port}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason) => logger.error("Unhandled rejection", { reason: String(reason) }));
