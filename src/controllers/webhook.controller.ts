import { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { normalizePhoneNumber } from "../utils/phone";
import { cleanExtension, downloadToUploads } from "../utils/download";
import { handleIncomingMessage, IncomingWhatsAppMessage } from "../bot/bot.engine";
import { asyncHandler } from "../utils/asyncHandler";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"];

// Fonnte kadang mengirim field kosong sebagai null / angka. Skema lama memakai
// z.string().optional() sehingga payload berisi null DITOLAK (HTTP 400) dan
// pesan (termasuk foto) hilang begitu saja. Semua field dibuat toleran.
const looseString = z.preprocess(
  (v) => (v === null || v === undefined ? undefined : String(v)),
  z.string().optional()
);

const fonnteWebhookSchema = z
  .object({
    device: looseString,
    sender: z.preprocess((v) => (v == null ? "" : String(v)), z.string().min(1, "sender is required")),
    message: looseString,
    text: looseString, // teks tombol
    name: looseString,
    member: looseString,
    location: looseString,
    url: looseString,
    filename: looseString,
    extension: looseString,
    timestamp: looseString,
  })
  .passthrough();

// Teks "pengganti" yang dipakai gateway ketika pesan bukan teks.
const NON_TEXT_PLACEHOLDER = /^\[?\s*(non[- ]?text message|image|photo|foto|gambar|document|dokumen|media|attachment)\s*\]?$/i;

/**
 * POST /webhook/fonnte
 * Selalu balas 200 untuk payload valid (Fonnte butuh 200), 400 untuk payload rusak.
 */
export const receiveFonnteWebhook = asyncHandler(async (req: Request, res: Response) => {
  if (env.fonnte.webhookSecret) {
    const providedSecret = req.query.secret;
    if (providedSecret !== env.fonnte.webhookSecret) {
      logger.error("Rejected webhook call: invalid secret");
      return res.status(401).json({ message: "Invalid webhook secret" });
    }
  }

  const parsed = fonnteWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.error("Rejected malformed Fonnte webhook payload", { errors: parsed.error.flatten() });
    return res.status(400).json({ message: "Invalid webhook payload" });
  }

  const data = parsed.data;
  const phoneNumber = normalizePhoneNumber(data.sender);
  if (!phoneNumber) {
    return res.status(400).json({ message: "Unable to normalize sender phone number" });
  }

  // Teks yang dilihat bot: pesan biasa, atau teks tombol.
  let text = (data.message || data.text || "").trim();

  let mediaLocalPath: string | null = null;
  let mediaRemoteUrl: string | null = null;
  let messageType: IncomingWhatsAppMessage["messageType"] = "text";
  let hasAttachment = false;

  const url = (data.url ?? "").trim();
  const hintedExt = cleanExtension(data.extension || (url ? url.split("?")[0].split(".").pop() : ""));

  if (data.location) {
    messageType = "location";
  } else if (url) {
    // ---- Ada lampiran dengan URL dari Fonnte ----
    hasAttachment = true;
    mediaRemoteUrl = url;

    const downloaded = await downloadToUploads(url, "incoming", hintedExt || undefined);
    mediaLocalPath = downloaded?.relativePath ?? null;

    const contentType = (downloaded?.contentType ?? "").toLowerCase();
    const finalExt = downloaded?.extension || hintedExt;
    const isImage = contentType.startsWith("image/") || IMAGE_EXTENSIONS.includes(finalExt);
    messageType = isImage ? "image" : "document";

    if (NON_TEXT_PLACEHOLDER.test(text)) text = "";
  } else if (!text || NON_TEXT_PLACEHOLDER.test(text)) {
    // ---- Tidak ada teks & tidak ada URL ----
    // Pesan WhatsApp tanpa teks pasti berupa lampiran (foto/dokumen/stiker/voice).
    // Fonnte hanya mengirim `url` untuk device dengan paket "all feature", jadi
    // kita tetap tandai sebagai lampiran (bukan teks kosong) agar bot bisa
    // menerimanya sebagai bukti dan admin mengecek langsung di WhatsApp.
    hasAttachment = true;
    messageType = "other";
    text = "";
  }

  // Log ringkas (tanpa isi pesan) supaya mudah diagnosa dari log server.
  logger.info("Incoming WhatsApp message", {
    phoneNumber,
    messageType,
    hasAttachment,
    hasUrl: Boolean(url),
    downloaded: Boolean(mediaLocalPath),
    payloadKeys: Object.keys(req.body ?? {}),
  });

  try {
    await handleIncomingMessage({
      phoneNumber,
      text,
      messageType,
      hasAttachment,
      mediaLocalPath,
      mediaRemoteUrl,
      senderName: data.name,
    });
  } catch (err) {
    logger.error("Bot engine failed to process incoming message", {
      error: err instanceof Error ? err.message : String(err),
      phoneNumber,
    });
  }

  return res.status(200).json({ received: true });
});
