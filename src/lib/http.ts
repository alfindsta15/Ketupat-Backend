import type { AppContext } from "../types";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Baca body JSON; body kosong / bukan JSON -> {} (mirip `req.body ?? {}` di Express). */
export async function readJson(c: AppContext): Promise<any> {
  try {
    return (await c.req.json()) ?? {};
  } catch {
    return {};
  }
}

/** Baca body webhook: JSON, x-www-form-urlencoded, atau multipart -> objek biasa. */
export async function readAnyBody(c: AppContext): Promise<Record<string, unknown>> {
  const type = (c.req.header("content-type") ?? "").toLowerCase();
  try {
    if (type.includes("application/json")) return ((await c.req.json()) as Record<string, unknown>) ?? {};
    if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const out: Record<string, unknown> = {};
      form.forEach((value, key) => {
        if (typeof value === "string") out[key] = value;
      });
      return out;
    }
    // Content-Type tidak jelas: coba JSON dulu.
    const text = await c.req.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return Object.fromEntries(new URLSearchParams(text));
    }
  } catch {
    return {};
  }
}
