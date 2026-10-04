import { prisma } from "../lib/prisma";
import { fonnteService } from "./fonnte.service";
import { logger } from "../utils/logger";

/** Kirim pesan WhatsApp ke customer + simpan ke riwayat chat. Tidak pernah melempar error. */
export async function notifyCustomer(phoneNumber: string, text: string): Promise<boolean> {
  try {
    await prisma.message.create({ data: { phoneNumber, direction: "OUT", message: text, messageType: "text" } });
  } catch (err) {
    logger.error("Gagal menyimpan log pesan", { error: err instanceof Error ? err.message : String(err) });
  }
  try {
    const result = await fonnteService.sendText(phoneNumber, text);
    return result.status === true;
  } catch (err) {
    logger.error("Gagal mengirim notifikasi WhatsApp", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
