import { z } from "zod";
import type { AppContext } from "../types";
import { HttpError, readJson } from "../lib/http";
import { env } from "../config/env";
import { getActiveQris, setActiveQris, setActiveQrisLink, clearActiveQris } from "../services/settings.service";
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
