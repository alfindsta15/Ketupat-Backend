import { env } from "../config/env";
import { logger } from "../utils/logger";

/**
 * Fonnte API response shape (see https://docs.fonnte.com/api-send-message/).
 * Failed requests come back with status:false and a "reason" instead of "detail".
 */
interface FonnteSuccessResponse {
  detail: string;
  id: string[];
  process: string;
  requestid: number;
  status: true;
  target: string[];
}

interface FonnteErrorResponse {
  status: false;
  reason: string;
  requestid?: number;
}

export type FonnteResponse = FonnteSuccessResponse | FonnteErrorResponse;

export interface SendMessageOptions {
  target: string; // normalized phone number(s), comma separated
  message?: string;
  url?: string; // public URL of image/file/document to attach
  filename?: string; // custom filename for non-image/video attachments
  typing?: boolean;
  delay?: string;
  countryCode?: string;
}

const SEND_ENDPOINT = () => `${env.fonnte.baseUrl.replace(/\/$/, "")}/send`;

/**
 * Low-level call to Fonnte's /send endpoint.
 * Never throws for "business" failures (invalid number, quota, etc.) - it
 * returns the Fonnte response as-is so callers can decide what to do.
 * Only throws for network-level failures (gateway unreachable, etc.).
 */
async function callFonnteSend(payload: SendMessageOptions): Promise<FonnteResponse> {
  if (!env.fonnte.token) {
    logger.error("Fonnte token is not configured. Set FONNTE_TOKEN in .env");
    return { status: false, reason: "FONNTE_TOKEN not configured on server" };
  }

  const body = new URLSearchParams();
  body.set("target", payload.target);
  if (payload.message) body.set("message", payload.message);
  if (payload.url) body.set("url", payload.url);
  if (payload.filename) body.set("filename", payload.filename);
  body.set("countryCode", payload.countryCode ?? "0"); // numbers are already normalized to 62xxxx
  if (payload.typing !== undefined) body.set("typing", String(payload.typing));
  if (payload.delay) body.set("delay", payload.delay);

  try {
    const response = await fetch(SEND_ENDPOINT(), {
      method: "POST",
      headers: {
        Authorization: env.fonnte.token, // Fonnte does not use "Bearer"
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = (await response.json()) as FonnteResponse;

    if (!data.status) {
      logger.error("Fonnte rejected the message", {
        target: payload.target,
        reason: (data as FonnteErrorResponse).reason,
      });
    } else {
      logger.info("Fonnte message queued", {
        target: payload.target,
        id: data.id,
        detail: data.detail,
      });
    }

    return data;
  } catch (err) {
    logger.error("Fonnte request failed (network error)", {
      target: payload.target,
      error: err instanceof Error ? err.message : String(err),
    });
    // We swallow the error here so the bot/API never crashes because the
    // WhatsApp gateway is temporarily unreachable.
    return { status: false, reason: "network error contacting Fonnte" };
  }
}

/** Send a plain text message. */
export async function sendText(target: string, message: string): Promise<FonnteResponse> {
  return callFonnteSend({ target, message, typing: true });
}

/** Send an image with an optional caption. `url` must be a public URL. */
export async function sendImage(
  target: string,
  imageUrl: string,
  caption?: string
): Promise<FonnteResponse> {
  logger.info("Sending Fonnte image", {
    target,
    imageUrl,
    hasCaption: Boolean(caption),
  });

  return callFonnteSend({ target, url: imageUrl, message: caption });
}

/** Send a document/file with an optional caption and custom filename. */
export async function sendDocument(
  target: string,
  fileUrl: string,
  filename?: string,
  caption?: string
): Promise<FonnteResponse> {
  return callFonnteSend({ target, url: fileUrl, filename, message: caption });
}

/**
 * Sends a WhatsApp sticker.
 *
 * Fonnte doesn't document a dedicated "sticker" parameter - it uses the same
 * `/send` + `url` mechanism as images. In practice, WhatsApp itself decides
 * whether an attachment renders as a photo or a sticker based on its format:
 * a `url` pointing to a static WEBP file (ideally ≤100KB, no caption - WA
 * stickers can't carry one) is what shows up as a sticker. Like every other
 * `url` attachment, this only works on Fonnte's super/advanced/ultra device
 * packages (see FONNTE_INTEGRATION notes in the README).
 */
export async function sendSticker(target: string, stickerUrl: string): Promise<FonnteResponse> {
  return callFonnteSend({ target, url: stickerUrl });
}

export const fonnteService = { sendText, sendImage, sendDocument, sendSticker };
