import { prisma } from "../lib/prisma";
import { CONVERSATION_STATE, FILE_TYPE, ORDER_STATUS, PAYMENT_KIND, PAYMENT_STATUS } from "../utils/constants";
import { logger } from "../utils/logger";
import { env } from "../config/env";
import { messages } from "../bot/bot.messages";
import { setState } from "../bot/bot.state";
import { notifyCustomer } from "./notification.service";
import { buildUploadUrl } from "./upload-link.service";
import { maybeSendSticker } from "../utils/sticker";
import { purgeCustomerFiles } from "./cleanup.service";
import { HttpError } from "../lib/http";
import { adminOrderUrl, notifyAdmins } from "./admin-notify.service";

export interface ProofFileMeta {
  filename?: string;
  mimeType?: string;
  size?: number;
}

/** DP = 50% dari total (dibulatkan), pelunasan = sisanya. */
export function splitPrice(price: number) {
  const dp = Math.round(price / 2);
  return { dp, final: price - dp };
}

/**
 * Tagihan berikutnya untuk sebuah order:
 * belum ada yang lunas -> DP 50%; sudah ada yang lunas tetapi belum penuh -> pelunasan (sisanya);
 * sudah lunas penuh -> null.
 */
export function nextPaymentSpec(price: number, payments: { amount: number; status: string }[]) {
  const paid = payments.filter((p) => p.status === PAYMENT_STATUS.PAID).reduce((sum, p) => sum + p.amount, 0);
  if (paid >= price) return null;
  if (paid === 0) return { kind: PAYMENT_KIND.DP as string, amount: splitPrice(price).dp };
  return { kind: PAYMENT_KIND.FINAL as string, amount: price - paid };
}

/**
 * Pastikan order yang sudah punya harga memiliki 1 baris Payment aktif (PENDING/REVIEW) untuk tagihan
 * berikutnya (DP atau pelunasan). Mengembalikan null bila order belum punya harga / sudah lunas penuh.
 * Baris lama bertipe FULL yang masih PENDING dibiarkan apa adanya (alur 1x bayar versi lama).
 */
export async function ensurePendingPayment(orderId: number) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payments: true } });
  if (!order || !order.price) return null;

  const active = order.payments
    .filter((p: any) => p.status === PAYMENT_STATUS.PENDING || p.status === PAYMENT_STATUS.REVIEW)
    .sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (active) {
    // Tagihan PENDING tanpa bukti selalu mengikuti aturan terbaru (DP 50% / pelunasan), termasuk baris lama bertipe FULL.
    if (active.status === PAYMENT_STATUS.PENDING && !active.proofFile) {
      const spec = nextPaymentSpec(order.price, order.payments);
      if (spec && (active.amount !== spec.amount || active.kind !== spec.kind)) {
        return prisma.payment.update({ where: { id: active.id }, data: { amount: spec.amount, kind: spec.kind } });
      }
    }
    return active;
  }

  const spec = nextPaymentSpec(order.price, order.payments);
  if (!spec) return null;
  return prisma.payment.create({ data: { orderId, amount: spec.amount, kind: spec.kind, status: PAYMENT_STATUS.PENDING } });
}

/** Menyimpan bukti pembayaran ke Payment (status REVIEW) & mengubah order -> PAYMENT_REVIEW. */
export async function submitPaymentProof(orderId: number, proofFilePath: string, meta: ProofFileMeta = {}) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

  let payment = await prisma.payment.findFirst({
    where: { orderId, status: { in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.REVIEW] } },
    orderBy: { createdAt: "desc" },
  });

  if (payment) {
    payment = await prisma.payment.update({
      where: { id: payment.id },
      data: { proofFile: proofFilePath, status: PAYMENT_STATUS.REVIEW },
    });
  } else {
    const all = await prisma.payment.findMany({ where: { orderId } });
    const spec = order.price ? nextPaymentSpec(order.price, all) : null;
    payment = await prisma.payment.create({
      data: {
        orderId,
        amount: spec?.amount ?? order.price ?? 0,
        kind: spec?.kind ?? PAYMENT_KIND.FULL,
        proofFile: proofFilePath,
        status: PAYMENT_STATUS.REVIEW,
      },
    });
  }

  await prisma.file.create({
    data: {
      orderId,
      type: FILE_TYPE.PROOF,
      url: proofFilePath,
      filename: meta.filename ?? "bukti-pembayaran",
      mimeType: meta.mimeType,
      size: meta.size,
      uploadedBy: "CUSTOMER",
    },
  });

  await prisma.order.update({ where: { id: orderId }, data: { status: ORDER_STATUS.PAYMENT_REVIEW } });
  logger.info("Payment proof uploaded", { orderId, paymentId: payment.id });
  return payment;
}

/**
 * Dipanggil saat customer selesai upload bukti lewat link khusus:
 * simpan bukti, sinkronkan state bot, lalu kirim WhatsApp
 * "mohon tunggu validasi admin" secara otomatis.
 */
export async function receivePaymentProof(orderId: number, proofFilePath: string, meta: ProofFileMeta = {}) {
  const payment = await submitPaymentProof(orderId, proofFilePath, meta);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { user: true } });

  await setState(order.user.phoneNumber, CONVERSATION_STATE.PAYMENT_REVIEW, {}, order.id);
  await notifyCustomer(order.user.phoneNumber, messages.proofReceived(order.orderNumber));
  await notifyAdmins(
    messages.adminProofReceived({
      orderNumber: order.orderNumber,
      customerName: order.user.name ?? order.user.phoneNumber,
      kind: payment.kind,
      amount: payment.amount,
      adminUrl: adminOrderUrl(order.id),
    })
  );
  return payment;
}

export async function verifyPayment(paymentId: number, adminId: number) {
  const payment = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: PAYMENT_STATUS.PAID, verifiedAt: new Date(), verifiedBy: adminId },
  });

  // DP / FULL -> pengerjaan dimulai. FINAL (pelunasan) -> pesanan selesai & hasil terbuka.
  const nextStatus = payment.kind === PAYMENT_KIND.FINAL ? ORDER_STATUS.COMPLETED : ORDER_STATUS.PROCESSING;
  const order = await prisma.order.update({ where: { id: payment.orderId }, data: { status: nextStatus } });

  logger.info("Payment verified", { orderId: order.id, orderNumber: order.orderNumber, adminId, kind: payment.kind });
  return { payment, order };
}

export async function rejectPayment(paymentId: number, adminId: number) {
  const payment = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: PAYMENT_STATUS.REJECTED, verifiedAt: new Date(), verifiedBy: adminId },
  });
  const order = await prisma.order.update({
    where: { id: payment.orderId },
    data: { status: payment.kind === PAYMENT_KIND.FINAL ? ORDER_STATUS.WAITING_FINAL_PAYMENT : ORDER_STATUS.WAITING_PAYMENT },
  });
  logger.info("Payment rejected", { orderId: order.id, adminId });
  return { payment, order };
}

/** Verifikasi + sinkron state bot + notifikasi WhatsApp (dengan catatan opsional). */
export async function verifyPaymentAndNotify(paymentId: number, adminId: number, note?: string, opts: { force?: boolean } = {}) {
  const existing = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: { include: { user: true } } },
  });
  if (!existing) return null;
  if (existing.status === PAYMENT_STATUS.PAID) {
    return { payment: existing, order: existing.order, alreadyPaid: true };
  }

  // ---- Validasi sebelum menandai lunas ----
  if (existing.order.status === ORDER_STATUS.CANCELLED) {
    throw new HttpError(400, "Pesanan ini sudah dibatalkan, pembayarannya tidak bisa diverifikasi.");
  }
  if (existing.status !== PAYMENT_STATUS.REVIEW && !opts.force) {
    throw new HttpError(
      400,
      existing.status === PAYMENT_STATUS.REJECTED
        ? "Bukti sebelumnya sudah ditolak. Tunggu customer mengupload bukti baru, atau gunakan 'Tandai lunas manual' bila sudah dibayar langsung."
        : "Customer belum mengupload bukti pembayaran. Tunggu bukti masuk, atau gunakan 'Tandai lunas manual' bila dibayar tunai/langsung."
    );
  }
  if (existing.kind === PAYMENT_KIND.FINAL) {
    const dpPaid = await prisma.payment.count({
      where: { orderId: existing.orderId, status: PAYMENT_STATUS.PAID, kind: { in: [PAYMENT_KIND.DP, PAYMENT_KIND.FULL] } },
    });
    if (dpPaid === 0) throw new HttpError(400, "Pelunasan tidak bisa diverifikasi karena DP 50% belum lunas.");
  }

  const { payment, order } = await verifyPayment(paymentId, adminId);
  const phone = existing.order.user.phoneNumber;

  if (payment.kind === PAYMENT_KIND.FINAL) {
    // Pelunasan terkonfirmasi: hasil terbuka, file kiriman customer dihapus, minta rating.
    await purgeCustomerFiles(order.id);
    await notifyCustomer(
      phone,
      messages.completed({ orderNumber: order.orderNumber, resultUrl: buildUploadUrl(order.id), note })
    );
    await maybeSendSticker(phone, env.stickers.completed);
    await setState(phone, CONVERSATION_STATE.REVIEW, {}, order.id);
    await notifyCustomer(phone, messages.askReview());
    return { payment, order, alreadyPaid: false };
  }

  await setState(phone, CONVERSATION_STATE.PROCESSING, {}, order.id);
  const remaining = order.price ? Math.max(0, order.price - payment.amount) : 0;
  await notifyCustomer(
    phone,
    messages.paymentVerified({
      orderNumber: order.orderNumber,
      amount: payment.amount || order.price || 0,
      note,
      kind: payment.kind,
      remaining,
    })
  );
  await maybeSendSticker(phone, env.stickers.paymentVerified);
  return { payment, order, alreadyPaid: false };
}

/** Tolak bukti + customer diminta upload ulang lewat link (dengan alasan opsional). */
export async function rejectPaymentAndNotify(paymentId: number, adminId: number, note?: string) {
  const existing = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: { include: { user: true } } },
  });
  if (!existing) return null;

  if (existing.status === PAYMENT_STATUS.PAID) throw new HttpError(400, "Pembayaran ini sudah lunas, tidak bisa ditolak.");
  if (existing.status !== PAYMENT_STATUS.REVIEW) {
    throw new HttpError(400, "Tidak ada bukti pembayaran yang perlu ditolak. Hanya bukti yang sudah diupload customer (status REVIEW) yang bisa ditolak.");
  }

  const { payment, order } = await rejectPayment(paymentId, adminId);
  const phone = existing.order.user.phoneNumber;

  // Siapkan baris Payment baru supaya bukti berikutnya tercatat rapi & riwayat penolakan tetap ada.
  await ensurePendingPayment(order.id);

  await setState(phone, CONVERSATION_STATE.WAITING_PAYMENT, {}, order.id);
  await notifyCustomer(
    phone,
    messages.paymentRejected({ orderNumber: order.orderNumber, note, uploadUrl: buildUploadUrl(order.id) })
  );
  return { payment, order };
}

/** Tandai payment aktif order sebagai PAID (dipakai saat admin mengubah status order manual). */
export async function markActivePaymentPaid(orderId: number, adminId?: number, opts: { skipFinal?: boolean } = {}) {
  const active = await prisma.payment.findFirst({
    where: { orderId, status: { in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.REVIEW] } },
    orderBy: { createdAt: "desc" },
  });
  if (!active) return null;
  // Mengubah status manual ke PROCESSING (mis. saat revisi) tidak boleh menandai pelunasan sebagai lunas.
  if (opts.skipFinal && active.kind === PAYMENT_KIND.FINAL) return null;
  return prisma.payment.update({
    where: { id: active.id },
    data: { status: PAYMENT_STATUS.PAID, verifiedAt: new Date(), verifiedBy: adminId ?? null },
  });
}

/**
 * Backfill data lama: order yang sudah punya harga tetapi belum punya baris
 * Payment (dibuat sebelum perbaikan) dibuatkan otomatis supaya muncul di menu
 * Payments. Aman dipanggil berulang.
 */
export async function backfillPayments() {
  const missing = await prisma.order.findMany({
    where: { price: { not: null }, payments: { none: {} }, status: { not: ORDER_STATUS.CANCELLED } },
    select: { id: true, price: true, status: true },
  });
  const paidStatuses: string[] = [ORDER_STATUS.PAID, ORDER_STATUS.PROCESSING, ORDER_STATUS.REVIEW, ORDER_STATUS.COMPLETED];

  for (const o of missing) {
    if (!o.price) continue;
    const paid = paidStatuses.includes(o.status);
    await prisma.payment.create({
      data: {
        orderId: o.id,
        amount: o.price,
        status: paid ? PAYMENT_STATUS.PAID : o.status === ORDER_STATUS.PAYMENT_REVIEW ? PAYMENT_STATUS.REVIEW : PAYMENT_STATUS.PENDING,
        verifiedAt: paid ? new Date() : null,
      },
    });
  }
  if (missing.length) logger.info("Backfilled missing payments", { count: missing.length });

  // Rapikan tagihan PENDING tanpa bukti agar mengikuti aturan DP 50% / pelunasan.
  const pending = await prisma.payment.findMany({
    where: {
      status: PAYMENT_STATUS.PENDING,
      proofFile: null,
      order: { price: { not: null }, status: { in: [ORDER_STATUS.WAITING_PAYMENT, ORDER_STATUS.WAITING_FINAL_PAYMENT] } },
    },
    select: { orderId: true },
  });
  for (const orderId of new Set(pending.map((p: { orderId: number }) => p.orderId))) await ensurePendingPayment(orderId as number);
}
