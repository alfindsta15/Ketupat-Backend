import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../../prisma/generated/client";
import type { Bindings } from "../config/env";
import { currentStore } from "./context";

export { Prisma };
export type { PrismaClient };

/** Buat PrismaClient baru untuk satu request. Hyperdrive dipakai bila ada, selain itu DATABASE_URL langsung. */
export function createPrismaClient(bindings: Bindings): PrismaClient {
  const connectionString = bindings.HYPERDRIVE?.connectionString || bindings.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL belum diset (wrangler secret put DATABASE_URL) dan binding HYPERDRIVE tidak ada.");
  }
  // Workers membatasi 6 koneksi keluar bersamaan -> pool kecil saja.
  const adapter = new PrismaPg({ connectionString, max: 5 });
  return new PrismaClient({ adapter });
}

/**
 * `prisma` global yang selalu menunjuk ke client milik request yang sedang berjalan.
 * Dipakai persis seperti sebelumnya: `await prisma.order.findMany(...)`.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = currentStore().getPrisma() as any;
    const value = client[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
