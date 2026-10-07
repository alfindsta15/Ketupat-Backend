import { z } from "zod";
import type { AppContext } from "../types";
import { prisma } from "../lib/prisma";
import { HttpError, readJson } from "../lib/http";
import { env } from "../config/env";
import { changeOrderStatusWithNotify, setOrderPrice } from "../services/order.service";
import { ensurePendingPayment } from "../services/payment.service";
import { getActiveQris, hasDynamicQris } from "../services/settings.service";
import { purgeCustomerFiles, purgeResultFiles } from "../services/cleanup.service";
import { notifyCustomer } from "../services/notification.service";
import { setState } from "../bot/bot.state";
import { messages } from "../bot/bot.messages";
import { serviceLabel } from "../bot/bot.handlers";
import { CONVERSATION_STATE, ORDER_STATUS, FILE_TYPE } from "../utils/constants";
import { logger } from "../utils/logger";
import { maybeSendSticker } from "../utils/sticker";
import { buildUploadUrl } from "../services/upload-link.service";
import { DOCUMENT_TYPES, IMAGE_TYPES, maxBytes, parseMultipartFields, saveUpload } from "../lib/storage";

function toPublicUrl(relativePath: string): string {
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  return `${env.appBaseUrl}${relativePath.startsWith("/") ? "" : "/"}${relativePath}`;
}

// ---------------------------------------------------------------------------
// GET /api/orders - list with search/filter/sort/pagination
// ---------------------------------------------------------------------------
const listQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  paymentStatus: z.string().optional(),
  sort: z.enum(["newest", "oldest", "price_asc", "price_desc"]).optional().default("newest"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export async function listOrders(c: AppContext) {
  const q = listQuerySchema.parse(c.req.query());

  const where: any = {};
  if (q.status) where.status = q.status;
  if (q.paymentStatus) where.payments = { some: { status: q.paymentStatus } };
  if (q.search) {
    where.OR = [
      { orderNumber: { contains: q.search, mode: "insensitive" } },
      { description: { contains: q.search, mode: "insensitive" } },
      { user: { name: { contains: q.search, mode: "insensitive" } } },
      { user: { phoneNumber: { contains: q.search } } },
    ];
  }

  const orderBy =
    q.sort === "oldest"
      ? { createdAt: "asc" as const }
      : q.sort === "price_asc"
      ? { price: "asc" as const }
      : q.sort === "price_desc"
      ? { price: "desc" as const }
      : { createdAt: "desc" as const };

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      include: { user: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
  ]);

  return c.json({
    data: orders,
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
  });
}

// ---------------------------------------------------------------------------
// GET /api/orders/:id - full detail
// ---------------------------------------------------------------------------
export async function getOrder(c: AppContext) {
  const id = Number(c.req.param("id"));
  const pre = await prisma.order.findUnique({ where: { id }, select: { status: true } });
  if (pre && (pre.status === ORDER_STATUS.WAITING_PAYMENT || pre.status === ORDER_STATUS.WAITING_FINAL_PAYMENT)) {
    await ensurePendingPayment(id); // rapikan tagihan lama agar sesuai DP 50% / pelunasan
  }
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      user: true,
      items: { orderBy: { createdAt: "asc" } },
      files: { orderBy: { createdAt: "asc" } },
      // Terbaru dulu, supaya pembayaran aktif (bukan yang lama/ditolak) yang tampil di dashboard.
      payments: { orderBy: { createdAt: "desc" }, include: { admin: { select: { id: true, name: true } } } },
      quotations: { orderBy: { createdAt: "desc" } },
      review: true,
    },
  });
  if (!order) throw new HttpError(404, "Order tidak ditemukan");

  const messagesLog = await prisma.message.findMany({
    where: { phoneNumber: order.user.phoneNumber },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return c.json({ ...order, messages: messagesLog, uploadUrl: buildUploadUrl(order.id) });
}

// ---------------------------------------------------------------------------
// POST /api/orders/:id/quotation - set price & send quotation via WhatsApp
// ---------------------------------------------------------------------------
const quotationSchema = z.object({
  price: z.coerce.number().positive(),
  note: z.string().max(2000).optional(),
});

export async function createQuotation(c: AppContext) {
  const id = Number(c.req.param("id"));
  const { price, note } = quotationSchema.parse(await readJson(c));

  const existing = await prisma.order.findUnique({ where: { id }, include: { user: true } });
  if (!existing) throw new HttpError(404, "Order tidak ditemukan");

  const order = await setOrderPrice(id, price, note?.trim() || undefined, c.get("admin").id);

  await setState(existing.user.phoneNumber, CONVERSATION_STATE.QUOTATION_SENT, {}, order.id);

  // Catatan admin ikut dikirim ke customer bersama jumlah pembayaran.
  const text = messages.quotation({
    orderNumber: order.orderNumber,
    serviceLabel: serviceLabel(order.service),
    price,
    deadline: order.deadline ?? "-",
    note: note?.trim(),
  });
  await notifyCustomer(existing.user.phoneNumber, text);

  return c.json(order);
}

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/status - ubah status; otomatis sinkron payment, state bot, & kirim WhatsApp
// ---------------------------------------------------------------------------
const statusSchema = z.object({
  status: z.enum([
    "WAITING_BRIEF",
    "WAITING_QUOTATION",
    "WAITING_PAYMENT",
    "PAYMENT_REVIEW",
    "PAID",
    "PROCESSING",
    "WAITING_FINAL_PAYMENT",
    "REVIEW",
    "COMPLETED",
    "CANCELLED",
  ]),
});

export async function changeOrderStatus(c: AppContext) {
  const id = Number(c.req.param("id"));
  const { status } = statusSchema.parse(await readJson(c));

  const { order, changed } = await changeOrderStatusWithNotify(id, status, c.get("admin").id);
  return c.json({ ...order, notified: changed });
}

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/note - internal admin note (not sent to customer)
// ---------------------------------------------------------------------------
const noteSchema = z.object({ adminNote: z.string().max(2000) });

export async function updateOrderNote(c: AppContext) {
  const id = Number(c.req.param("id"));
  const { adminNote } = noteSchema.parse(await readJson(c));
  const order = await prisma.order.update({ where: { id }, data: { adminNote } });
  return c.json(order);
}

// ---------------------------------------------------------------------------
// POST /api/orders/:id/message - free-text message from admin to customer
// ---------------------------------------------------------------------------
const messageSchema = z.object({ message: z.string().min(1).max(4000) });

export async function sendCustomerMessage(c: AppContext) {
  const id = Number(c.req.param("id"));
  const { message } = messageSchema.parse(await readJson(c));

  const order = await prisma.order.findUnique({ where: { id }, include: { user: true } });
  if (!order) throw new HttpError(404, "Order tidak ditemukan");

  const sent = await notifyCustomer(order.user.phoneNumber, message);
  return c.json({ sent });
}

// ---------------------------------------------------------------------------
// POST /api/orders/:id/result - kirim hasil (file dan/atau link) + catatan, tandai COMPLETED
// multipart/form-data: file (opsional), resultLink (opsional), note (opsional)
// ---------------------------------------------------------------------------
const resultBodySchema = z.object({
  resultLink: z.string().trim().url("Link hasil harus berupa URL yang valid").optional().or(z.literal("")),
  note: z.string().max(2000).optional(),
});

/**
 * POST /api/orders/:id/result  (multipart)
 *   file      : file hasil asli (opsional jika pakai resultLink) -> TERKUNCI sampai lunas
 *   resultLink: link hasil (Drive/GitHub/dll)                   -> TERKUNCI sampai lunas
 *   previews  : gambar pratinjau (maks. 8) yang dibuat otomatis oleh dashboard dari file hasil (sudah ber-watermark & dikecilkan)
 *   note      : catatan untuk customer
 * Efek: status -> WAITING_FINAL_PAYMENT, tagihan pelunasan dibuat, customer dikirimi link pratinjau.
 * Bila order sudah lunas penuh (mis. order lama), langsung SELESAI & hasil terbuka.
 */
export async function uploadOrderResult(c: AppContext) {
  const id = Number(c.req.param("id"));
  const { files, fields } = await parseMultipartFields(c.req.raw, {
    file: { allowed: DOCUMENT_TYPES, anyType: true, maxFileBytes: maxBytes() * 4, maxFiles: 1 },
    previews: { allowed: IMAGE_TYPES, maxFileBytes: maxBytes(), maxFiles: 8 },
  });
  const final = files.file[0];
  const previews = files.previews;
  const { resultLink, note } = resultBodySchema.parse(fields);

  if (!final && !resultLink) throw new HttpError(400, "Upload file hasil atau isi link hasil.");

  const order = await prisma.order.findUnique({ where: { id }, include: { user: true, payments: true } });
  if (!order) throw new HttpError(404, "Order tidak ditemukan");
  if (!order.price) throw new HttpError(400, "Harga belum diisi. Kirim quotation dulu.");

  const paidTotal = order.payments.filter((p: { status: string }) => p.status === "PAID").reduce((s: number, p: { amount: number }) => s + p.amount, 0);
  const fullyPaid = paidTotal >= order.price;
  if (!fullyPaid && !order.payments.some((p: { status: string }) => p.status === "PAID")) {
    throw new HttpError(400, "DP 50% belum dibayar/diverifikasi. Verifikasi pembayaran DP dulu sebelum mengirim hasil.");
  }

  // Kirim ulang (mis. setelah revisi): buang pratinjau & hasil lama.
  await purgeResultFiles(id);

  let resultRef: string;
  if (final) {
    const saved = await saveUpload("final", final);
    resultRef = saved.relativePath;
    await prisma.file.create({
      data: { orderId: id, type: FILE_TYPE.RESULT, url: saved.relativePath, filename: saved.originalName, mimeType: saved.mimeType, size: saved.size, uploadedBy: "ADMIN" },
    });
  } else {
    resultRef = resultLink as string;
  }
  for (const p of previews) {
    const saved = await saveUpload("preview", p);
    await prisma.file.create({
      data: { orderId: id, type: FILE_TYPE.PREVIEW, url: saved.relativePath, filename: saved.originalName, mimeType: saved.mimeType, size: saved.size, uploadedBy: "ADMIN" },
    });
  }

  const cleanNote = note?.trim() || undefined;
  if (cleanNote) {
    await prisma.orderItem.create({ data: { orderId: id, label: "Catatan hasil", value: cleanNote } });
  }

  const phone = order.user.phoneNumber;

  // ---- Order lama yang sudah lunas penuh: langsung selesai & terbuka ----
  if (fullyPaid) {
    const updated = await prisma.order.update({ where: { id }, data: { resultUrl: resultRef, status: ORDER_STATUS.COMPLETED } });
    await purgeCustomerFiles(id);
    await notifyCustomer(phone, messages.completed({ orderNumber: updated.orderNumber, resultUrl: buildUploadUrl(id), note: cleanNote }));
    await maybeSendSticker(phone, env.stickers.completed);
    await setState(phone, CONVERSATION_STATE.REVIEW, {}, updated.id);
    await notifyCustomer(phone, messages.askReview());
    logger.info("Order marked completed (already fully paid)", { orderNumber: updated.orderNumber });
    return c.json(updated);
  }

  // ---- Alur DP: pratinjau dulu, file asli terkunci sampai pelunasan ----
  const updated = await prisma.order.update({ where: { id }, data: { resultUrl: resultRef, status: ORDER_STATUS.WAITING_FINAL_PAYMENT } });
  const pending = await ensurePendingPayment(id);
  const qris = await getActiveQris();
  await setState(phone, CONVERSATION_STATE.WAITING_PAYMENT, {}, updated.id);
  await notifyCustomer(
    phone,
    messages.resultPreview({
      orderNumber: updated.orderNumber,
      remaining: pending?.amount ?? order.price - paidTotal,
      uploadUrl: buildUploadUrl(id),
      qrisUrl: qris?.url,
      dynamicQris: await hasDynamicQris(),
      note: cleanNote,
    })
  );

  logger.info("Result preview sent, waiting final payment", { orderNumber: updated.orderNumber });
  return c.json(updated);
}

/** GET /api/orders/:id/files/:fileId/download  (admin) - unduh file apa pun milik order, termasuk hasil terkunci. */
export async function downloadOrderFile(c: AppContext) {
  const orderId = Number(c.req.param("id"));
  const fileId = Number(c.req.param("fileId"));
  const file = await prisma.file.findFirst({ where: { id: fileId, orderId } });
  if (!file) throw new HttpError(404, "File tidak ditemukan");

  const stored = await prisma.upload.findUnique({ where: { key: file.url.replace(/^\/uploads\//, "") } });
  if (!stored) throw new HttpError(404, "Isi file sudah tidak ada (mungkin sudah dihapus otomatis).");

  const safeName = file.filename.replace(/[^\w.\- ]+/g, "_");
  return new Response(stored.data as unknown as BodyInit, {
    headers: {
      "Content-Type": stored.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function listReviews(c: AppContext) {
  const reviews = await prisma.review.findMany({
    include: { order: { select: { orderNumber: true, service: true, userId: true } } },
    orderBy: { createdAt: "desc" },
  });
  return c.json(reviews);
}
