import { prisma } from "../lib/prisma";
import { CONVERSATION_STATE, FILE_TYPE, ORDER_STATUS, PAYMENT_STATUS } from "../utils/constants";
import { logger } from "../utils/logger";
import { env } from "../config/env";
import { messages } from "../bot/bot.messages";
import { setState } from "../bot/bot.state";
import { notifyCustomer } from "./notification.service";
import { buildUploadUrl } from "./upload-link.service";
import { maybeSendSticker } from "../utils/sticker";

export interface ProofFileMeta {
  filename?: string;
  mimeType?: string;
  size?: number;
}

/**
 * Pastikan order yang sudah punya harga memiliki 1 baris Payment aktif
 * (PENDING/REVIEW). Mengembalikan null bila order belum punya harga.
 */
export async function ensurePendingPayment(orderId: number) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || !order.price) return null;

  const active = await prisma.payment.findFirst({
    where: { orderId, status: { in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.REVIEW] } },
    orderBy: { createdAt: "desc" },
  });
  if (active) {
    if (active.status === PAYMENT_STATUS.PENDING && active.amount !== order.price) {
      return prisma.payment.update({ where: { id: active.id }, data: { amount: order.price } });
    }
    return active;
  }
  return prisma.payment.create({ data: { orderId, amount: order.price, status: PAYMENT_STATUS.PENDING } });
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
    payment = await prisma.payment.create({
      data: { orderId, amount: order.price ?? 0, proofFile: proofFilePath, status: PAYMENT_STATUS.REVIEW },
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
  return payment;
}

export async function verifyPayment(paymentId: number, adminId: number) {
  const payment = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: PAYMENT_STATUS.PAID, verifiedAt: new Date(), verifiedBy: adminId },
  });

  const order = await prisma.order.update({
    where: { id: payment.orderId },
    data: { status: ORDER_STATUS.PROCESSING },
  });

  logger.info("Payment verified", { orderId: order.id, orderNumber: order.orderNumber, adminId });
  return { payment, order };
}

export async function rejectPayment(paymentId: number, adminId: number) {
  const payment = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: PAYMENT_STATUS.REJECTED, verifiedAt: new Date(), verifiedBy: adminId },
  });
  const order = await prisma.order.update({
    where: { id: payment.orderId },
    data: { status: ORDER_STATUS.WAITING_PAYMENT },
  });
  logger.info("Payment rejected", { orderId: order.id, adminId });
  return { payment, order };
}

/** Verifikasi + sinkron state bot + notifikasi WhatsApp (dengan catatan opsional). */
export async function verifyPaymentAndNotify(paymentId: number, adminId: number, note?: string) {
  const existing = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: { include: { user: true } } },
  });
  if (!existing) return null;
  if (existing.status === PAYMENT_STATUS.PAID) {
    return { payment: existing, order: existing.order, alreadyPaid: true };
  }

  const { payment, order } = await verifyPayment(paymentId, adminId);
  const phone = existing.order.user.phoneNumber;

  await setState(phone, CONVERSATION_STATE.PROCESSING, {}, order.id);
  await notifyCustomer(
    phone,
    messages.paymentVerified({ orderNumber: order.orderNumber, amount: payment.amount || order.price || 0, note })
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
export async function markActivePaymentPaid(orderId: number, adminId?: number) {
  const active = await prisma.payment.findFirst({
    where: { orderId, status: { in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.REVIEW] } },
    orderBy: { createdAt: "desc" },
  });
  if (!active) return null;
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
}
