import type { Bindings } from "../config/env";

let current: Bindings | null = null;

/** Dipanggil di awal setiap request (worker.ts). Bindings Workers bersifat tetap antar request. */
export function setBindings(b: Bindings) {
  current = b;
}

export function currentBindings(): Bindings {
  if (!current) throw new Error("Bindings Worker belum diinisialisasi.");
  return current;
}
