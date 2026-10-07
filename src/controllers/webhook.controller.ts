import { z } from "zod";
import type { AppContext } from "../types";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { normalizePhoneNumber } from "../utils/phone";
import { cleanExtension, downloadToUploads } from "../utils/download";
import { handleIncomingMessage, IncomingWhatsAppMessage } from "../bot/bot.engine";
import { readAnyBody } from "../lib/http";
import { runInBackground } from "../lib/context";
import { deleteStoredFile } from "../lib/storage";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"];

// Fonnte kadang mengirim field kosong sebagai null / angka. Semua field dibuat toleran
// supaya payload yang aneh tidak ditolak (HTTP 400) lalu pesan/foto hilang begitu saja.
const looseString = z.preprocess((v) => (v === null || v === undefined ? undefined : String(v)), z.string().optional());

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
 * Validasi cepat -> balas 200 SEGERA -> proses bot di latar belakang (waitUntil).
 * Dengan begitu Fonnte tidak timeout/retry (yang bisa membuat pesan terproses dobel).
 */
export async function receiveFonnteWebhook(c: AppContext) {
  if (env.fonnte.webhookSecret) {
    const providedSecret = c.req.query("secret");
    if (providedSecret !== env.fonnte.webhookSecret) {
      logger.error("Rejected webhook call: invalid secret");
      return c.json({ message: "Invalid webhook secret" }, 401);
    }
  }

  const body = await readAnyBody(c);
  const parsed = fonnteWebhookSchema.safeParse(body);
  if (!parsed.success) {
    logger.error("Rejected malformed Fonnte webhook payload", { errors: parsed.error.flatten() });
    return c.json({ message: "Invalid webhook payload" }, 400);
  }

  const data = parsed.data;

  // Pesan dari GRUP WhatsApp (mis. grup admin tempat bot dimasukkan) tidak boleh dijawab bot sebagai customer.
  if ((data.member ?? "").trim() || data.sender.includes("@g.us")) {
    // `sender` pada pesan grup biasanya = ID grup (…@g.us). Dicatat agar admin bisa mengambil ID grup lewat `wrangler tail`.
    logger.info("Group message ignored", { sender: data.sender, member: data.member ?? null });
    return c.json({ received: true, ignored: "group-message" }, 200);
  }

  const phoneNumber = normalizePhoneNumber(data.sender);
  if (!phoneNumber) {
    return c.json({ message: "Unable to normalize sender phone number" }, 400);
  }

  runInBackground(processIncoming(data, phoneNumber, Object.keys(body)));
  return c.json({ received: true }, 200);
}

async function processIncoming(data: z.infer<typeof fonnteWebhookSchema>, phoneNumber: string, payloadKeys: string[]) {
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
    // Pesan WhatsApp tanpa teks pasti berupa lampiran (foto/dokumen/stiker/voice). Fonnte hanya
    // mengirim `url` untuk paket "all feature", jadi tetap ditandai sebagai lampiran.
    hasAttachment = true;
    messageType = "other";
    text = "";
  }

  logger.info("Incoming WhatsApp message", {
    phoneNumber,
    messageType,
    hasAttachment,
    hasUrl: Boolean(url),
    downloaded: Boolean(mediaLocalPath),
    payloadKeys,
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
  } finally {
    // Lampiran lewat chat tidak diproses (customer diarahkan ke link upload), jadi salinan sementara dihapus.
    await deleteStoredFile(mediaLocalPath).catch(() => undefined);
  }
}
