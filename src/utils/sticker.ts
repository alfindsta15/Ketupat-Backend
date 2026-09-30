import { fonnteService } from "../services/fonnte.service";
import { logger } from "./logger";

/**
 * Sends a sticker only if a URL is configured; silently does nothing
 * otherwise so this can be called unconditionally from anywhere without
 * extra if-checks at every call site. Never throws - a failed/misconfigured
 * sticker should never break the main WhatsApp flow.
 */
export async function maybeSendSticker(phoneNumber: string, stickerUrl?: string | null) {
  if (!stickerUrl) return;
  try {
    const result = await fonnteService.sendSticker(phoneNumber, stickerUrl);
    if (!result.status) {
      logger.error("Gagal mengirim stiker", { phoneNumber });
    }
  } catch (err) {
    logger.error("Error saat mengirim stiker", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
