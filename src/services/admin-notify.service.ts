import { env } from "../config/env";
import { logger } from "../utils/logger";
import { fonnteService } from "./fonnte.service";

/** Link halaman detail order di dashboard admin (frontend). */
export function adminOrderUrl(orderId: number): string {
  const base = env.frontendUrl.split(",")[0].trim().replace(/\/$/, "");
  return `${base}/orders/${orderId}`;
}

/**
 * Kirim pesan ke para admin: ke grup WhatsApp (ADMIN_WHATSAPP_GROUP_ID) bila diisi,
 * dan bila grup gagal / tidak diisi, ke ADMIN_WHATSAPP_NUMBER. Tidak pernah melempar error.
 */
export async function notifyAdmins(text: string): Promise<boolean> {
  const group = env.adminWhatsappGroupId;
  const number = env.adminWhatsappNumber;
  if (!group && !number) {
    logger.warn("ADMIN_WHATSAPP_GROUP_ID / ADMIN_WHATSAPP_NUMBER belum diisi - notifikasi admin tidak terkirim");
    return false;
  }

  const targets = [group, number].filter(Boolean) as string[];
  for (const target of targets) {
    try {
      const result = await fonnteService.sendText(target, text);
      if (result.status === true) return true;
      logger.error("Notifikasi admin ditolak Fonnte", { target: target === group ? "group" : "number" });
    } catch (err) {
      logger.error("Notifikasi admin gagal", { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return false;
}
