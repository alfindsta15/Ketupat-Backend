import { prisma } from "../lib/prisma";
import { deleteStoredFile } from "../lib/storage";
import { FILE_TYPE } from "../utils/constants";
import { logger } from "../utils/logger";

/**
 * Hapus file yang dikirim customer (referensi / brief) dari database setelah pesanan selesai.
 * Bukti pembayaran (PROOF) sengaja TIDAK dihapus. File hasil & pratinjau buatan admin juga tidak dihapus.
 */
export async function purgeCustomerFiles(orderId: number): Promise<number> {
  try {
    const files = await prisma.file.findMany({
      where: { orderId, type: { in: [FILE_TYPE.REFERENCE, FILE_TYPE.BRIEF] } },
    });
    for (const f of files) await deleteStoredFile(f.url);
    if (files.length) {
      await prisma.file.deleteMany({ where: { id: { in: files.map((f: { id: number }) => f.id) } } });
      logger.info("Customer files purged after completion", { orderId, count: files.length });
    }
    return files.length;
  } catch (err) {
    logger.error("Gagal menghapus file customer", { orderId, error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

/** Hapus pratinjau & file hasil lama (dipakai saat admin mengirim ulang hasil setelah revisi). */
export async function purgeResultFiles(orderId: number): Promise<void> {
  const files = await prisma.file.findMany({ where: { orderId, type: { in: [FILE_TYPE.RESULT, FILE_TYPE.PREVIEW] } } });
  for (const f of files) await deleteStoredFile(f.url);
  if (files.length) await prisma.file.deleteMany({ where: { id: { in: files.map((f: { id: number }) => f.id) } } });
}
