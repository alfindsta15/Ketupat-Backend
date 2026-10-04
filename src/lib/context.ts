import { AsyncLocalStorage } from "node:async_hooks";
import type { ExecutionContext } from "@cloudflare/workers-types";

/**
 * Data yang hanya berlaku untuk SATU request Worker.
 * PrismaClient (koneksi TCP) tidak boleh dipakai lintas request di Workers, jadi
 * setiap request punya client sendiri; `prisma` di lib/prisma.ts mengambil yang aktif lewat
 * AsyncLocalStorage ini, sehingga seluruh service lama tetap cukup `import { prisma }`.
 */
export interface RequestStore {
  getPrisma: () => unknown;
  /** Pekerjaan latar (mis. memproses webhook) yang harus selesai sebelum koneksi DB ditutup. */
  tasks: Promise<unknown>[];
  ctx?: ExecutionContext;
}

export const requestContext = new AsyncLocalStorage<RequestStore>();

export function currentStore(): RequestStore {
  const store = requestContext.getStore();
  if (!store) throw new Error("Tidak ada konteks request aktif (prisma dipanggil di luar request).");
  return store;
}

/** Jalankan promise di latar belakang tetapi tetap dijamin selesai (waitUntil). */
export function runInBackground(task: Promise<unknown>) {
  const store = currentStore();
  const safe = task.catch(() => undefined);
  store.tasks.push(safe);
  store.ctx?.waitUntil(safe);
}
