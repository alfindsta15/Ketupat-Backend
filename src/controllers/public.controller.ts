import { z } from "zod";
import type { AppContext } from "../types";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http";
import { parseUploadToken } from "../services/upload-link.service";
import { receivePaymentProof } from "../services/payment.service";
import { getActiveQris } from "../services/settings.service";
import { notifyCustomer } from "../services/notification.service";
import { messages } from "../bot/bot.messages";
import { serviceLabel } from "../bot/bot.handlers";
import { FILE_TYPE, ORDER_STATUS } from "../utils/constants";
import { logger } from "../utils/logger";
import { CUSTOMER_IMAGE_TYPES, DOCUMENT_TYPES, maxBytes, parseMultipart, saveUpload } from "../lib/storage";

const CLOSED_STATUSES: string[] = [ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED];

/** Validasi token link upload dan ambil order-nya. Token salah -> 404 (tidak membocorkan apa pun). */
async function loadOrderFromToken(token: string) {
  const orderId = parseUploadToken(token);
  if (!orderId) throw new HttpError(404, "Link upload tidak valid.");
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!order) throw new HttpError(404, "Link upload tidak valid.");
  return order;
}

/** GET /api/public/upload/:token - info yang dibutuhkan halaman upload. */
export async function getUploadInfo(c: AppContext) {
  const order = await loadOrderFromToken(c.req.param("token") ?? "");
  const payment = order.payments[0] ?? null;
  const closed = CLOSED_STATUSES.includes(order.status);
  const qris = await getActiveQris();

  const canUploadProof =
    !closed && Boolean(order.price) && (order.status === ORDER_STATUS.WAITING_PAYMENT || order.status === ORDER_STATUS.PAYMENT_REVIEW);

  return c.json({
    orderNumber: order.orderNumber,
    service: order.service,
    serviceLabel: serviceLabel(order.service),
    customerName: order.user.name,
    status: order.status,
    price: order.price,
    paymentStatus: payment?.status ?? null,
    proofUploaded: Boolean(payment?.proofFile) && payment?.status !== "REJECTED",
    qrisUrl: qris?.url ?? null,
    closed,
    canUploadProof,
    canUploadReference: !closed,
  });
}

/** POST /api/public/upload/:token/proof - bukti pembayaran (1 file). */
export async function uploadProofPublic(c: AppContext) {
  const order = await loadOrderFromToken(c.req.param("token") ?? "");
  const { files } = await parseMultipart(c.req.raw, {
    field: "file",
    allowed: [...CUSTOMER_IMAGE_TYPES, "application/pdf"],
    maxFileBytes: maxBytes(),
    maxFiles: 1,
  });
  const file = files[0];
  if (!file) throw new HttpError(400, "Pilih foto/PDF bukti pembayaran dulu.");

  const okStatus = order.status === ORDER_STATUS.WAITING_PAYMENT || order.status === ORDER_STATUS.PAYMENT_REVIEW;
  if (!order.price || !okStatus) {
    throw new HttpError(400, "Pesanan ini belum menunggu pembayaran. Tunggu quotation dari admin dulu ya.");
  }

  const saved = await saveUpload("proof", file);
  const payment = await receivePaymentProof(order.id, saved.relativePath, {
    filename: saved.originalName,
    mimeType: saved.mimeType,
    size: saved.size,
  });

  return c.json({ ok: true, paymentStatus: payment.status });
}

const referenceBodySchema = z.object({ note: z.string().max(2000).optional() });

/** POST /api/public/upload/:token/reference - referensi non-teks (maks 5 file) + catatan opsional. */
export async function uploadReferencePublic(c: AppContext) {
  const order = await loadOrderFromToken(c.req.param("token") ?? "");
  if (CLOSED_STATUSES.includes(order.status)) {
    throw new HttpError(400, "Pesanan ini sudah selesai/dibatalkan, upload referensi sudah ditutup.");
  }

  const { files, fields } = await parseMultipart(c.req.raw, {
    field: "files",
    allowed: [...DOCUMENT_TYPES, ...CUSTOMER_IMAGE_TYPES],
    maxFileBytes: maxBytes() * 2,
    maxFiles: 5,
  });
  const { note } = referenceBodySchema.parse(fields);
  if (files.length === 0 && !note?.trim()) throw new HttpError(400, "Pilih minimal 1 file atau tulis catatan.");

  for (const f of files) {
    const saved = await saveUpload("reference", f);
    await prisma.file.create({
      data: {
        orderId: order.id,
        type: FILE_TYPE.REFERENCE,
        url: saved.relativePath,
        filename: saved.originalName,
        mimeType: saved.mimeType,
        size: saved.size,
        uploadedBy: "CUSTOMER",
      },
    });
  }
  if (note?.trim()) {
    await prisma.orderItem.create({ data: { orderId: order.id, label: "Catatan tambahan", value: note.trim() } });
  }

  logger.info("Reference uploaded via link", { orderNumber: order.orderNumber, files: files.length });

  if (files.length > 0) {
    await notifyCustomer(order.user.phoneNumber, messages.referenceReceived({ orderNumber: order.orderNumber, fileCount: files.length }));
  }

  return c.json({ ok: true, fileCount: files.length });
}
