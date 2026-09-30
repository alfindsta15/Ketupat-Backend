import { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { normalizePhoneNumber } from "../utils/phone";
import { downloadToUploads } from "../utils/download";
import { handleIncomingMessage } from "../bot/bot.engine";
import { asyncHandler } from "../utils/asyncHandler";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];

// Fonnte's webhook payload isn't fully typed by them, so we validate loosely:
// only `sender` is truly required for us to route the message anywhere.
const fonnteWebhookSchema = z.object({
  device: z.string().optional(),
  sender: z.string().min(1, "sender is required"),
  message: z.string().optional().default(""),
  text: z.string().optional(), // button reply text
  name: z.string().optional(),
  member: z.string().optional(), // group sender, unused (we operate 1:1 only)
  location: z.string().optional(),
  url: z.string().optional(),
  filename: z.string().optional(),
  extension: z.string().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
});

/**
 * POST /webhook/fonnte
 * Receives every inbound WhatsApp message/event from Fonnte and forwards it
 * to the bot's conversation engine. Always returns HTTP 200 on successfully
 * parsed payloads (Fonnte requires 200 to consider the webhook delivered),
 * and HTTP 400 on invalid/unparseable payloads.
 */
export const receiveFonnteWebhook = asyncHandler(async (req: Request, res: Response) => {
  // Optional shared-secret check. Configure FONNTE_WEBHOOK_SECRET and add
  // ?secret=... to the webhook URL you register in the Fonnte dashboard.
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
  logger.debug("Fonnte webhook payload", { body: req.body });

  const phoneNumber = normalizePhoneNumber(data.sender);

  if (!phoneNumber) {
    return res.status(400).json({ message: "Unable to normalize sender phone number" });
  }

  let mediaLocalPath: string | null = null;
  let messageType: "text" | "image" | "document" | "location" | "other" = "text";

  if (data.location) {
    messageType = "location";
  } else if (data.url) {
    const ext = (data.extension || data.url.split(".").pop() || "").toLowerCase();
    messageType = IMAGE_EXTENSIONS.includes(ext) ? "image" : "document";
    const downloaded = await downloadToUploads(data.url, "incoming", ext || undefined);
    mediaLocalPath = downloaded?.relativePath ?? null;
  }

  logger.info("Incoming WhatsApp message", {
    phoneNumber,
    messageType,
    hasAttachment: Boolean(data.url),
  });

  try {
    await handleIncomingMessage({
  phoneNumber,
  text: data.message || "",
  messageType,
  mediaLocalPath,
  senderName: data.name,
});
  } catch (err) {
    // Never let a bot-logic bug take down the webhook / crash the server.
    logger.error("Bot engine failed to process incoming message", {
      error: err instanceof Error ? err.message : String(err),
      phoneNumber,
    });
  }

  return res.status(200).json({ received: true });
});
