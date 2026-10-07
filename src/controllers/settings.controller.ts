import { z } from "zod";
import type { AppContext } from "../types";
import { HttpError, readJson } from "../lib/http";
import { env } from "../config/env";
import {
  getActiveQris,
  setActiveQris,
  setActiveQrisLink,
  clearActiveQris,
  getQrisPayload,
  setQrisPayload,
  clearQrisPayload,
} from "../services/settings.service";
import { cleanQrisPayload, makeDynamicQris, qrisMerchantName, validateQrisPayload } from "../lib/qris";
import { qrToSvg } from "../lib/qr";
import { IMAGE_TYPES, maxBytes, parseMultipart, saveUpload } from "../lib/storage";
import { logger } from "../utils/logger";

function toPublicUrl(relativePath: string): string {
  return `${env.appBaseUrl}${relativePath.startsWith("/") ? "" : "/"}${relativePath}`;
}

export async function getQris(c: AppContext) {
  return c.json(await getActiveQris());
}

export async function uploadQrisController(c: AppContext) {
  const { files } = await parseMultipart(c.req.raw, { field: "file", allowed: IMAGE_TYPES, maxFileBytes: maxBytes(), maxFiles: 1 });
  const file = files[0];
  if (!file) throw new HttpError(400, "File QRIS wajib diupload");

  const saved = await saveUpload("qris", file);
  const url = toPublicUrl(saved.relativePath);
  await setActiveQris(url, saved.originalName);
  logger.info("QRIS updated", { filename: saved.originalName });

  return c.json({ url, filename: saved.originalName });
}

const qrisLinkSchema = z.object({ url: z.string().url("Link QRIS harus berupa URL yang valid") });

/** Set QRIS aktif dari link yang ditempel (bukan upload). */
export async function setQrisLinkController(c: AppContext) {
  const { url } = qrisLinkSchema.parse(await readJson(c));
  await setActiveQrisLink(url);
  logger.info("QRIS link updated", { url });
  return c.json({ url, filename: "Link QRIS" });
}

export async function deleteQrisController(c: AppContext) {
  await clearActiveQris();
  return c.json({ deleted: true });
}

/** GET /api/settings/qris/dynamic - status QRIS dinamis (tanpa membocorkan isi kode). */
export async function getDynamicQris(c: AppContext) {
  const payload = await getQrisPayload();
  return c.json({ enabled: Boolean(payload), merchant: payload ? qrisMerchantName(payload) : null });
}

const qrisPayloadSchema = z.object({ payload: z.string().min(20, "Kode QRIS terlalu pendek").max(2000) });

/** POST /api/settings/qris/payload  { payload } - simpan kode QRIS statis (teks hasil scan) untuk QRIS dinamis. */
export async function setDynamicQris(c: AppContext) {
  const { payload } = qrisPayloadSchema.parse(await readJson(c));
  const clean = cleanQrisPayload(payload);
  const problem = validateQrisPayload(clean);
  if (problem) throw new HttpError(400, problem);
  await setQrisPayload(clean);
  logger.info("QRIS dinamis diaktifkan");
  return c.json({ enabled: true, merchant: qrisMerchantName(clean) });
}

export async function deleteDynamicQris(c: AppContext) {
  await clearQrisPayload();
  return c.json({ enabled: false, merchant: null });
}

/** GET /api/settings/qris/preview.svg?amount=10000 (admin) - contoh QRIS dinamis untuk dites dengan aplikasi pembayaran. */
export async function previewDynamicQris(c: AppContext) {
  const payload = await getQrisPayload();
  if (!payload) throw new HttpError(404, "QRIS dinamis belum diaktifkan.");
  const amount = Math.round(Number(c.req.query("amount") ?? 10000));
  if (!Number.isFinite(amount) || amount < 1 || amount > 99999999) throw new HttpError(400, "Nominal contoh tidak valid (1 - 99.999.999).");
  return new Response(qrToSvg(makeDynamicQris(payload, amount), 360), {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" },
  });
}
