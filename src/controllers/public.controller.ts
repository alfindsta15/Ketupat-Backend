import { z } from "zod";
import type { AppContext } from "../types";
import { prisma } from "../lib/prisma";
import { HttpError, readJson } from "../lib/http";
import { parseUploadToken } from "../services/upload-link.service";
import { ensurePendingPayment, nextPaymentSpec, receivePaymentProof, splitPrice } from "../services/payment.service";
import { adminOrderUrl, notifyAdmins } from "../services/admin-notify.service";
import { setState } from "../bot/bot.state";
import { getActiveQris, getQrisPayload } from "../services/settings.service";
import { makeDynamicQris } from "../lib/qris";
import { qrToSvg } from "../lib/qr";
import { notifyCustomer } from "../services/notification.service";
import { messages } from "../bot/bot.messages";
import { serviceLabel } from "../bot/bot.handlers";
import { CONVERSATION_STATE, FILE_TYPE, ORDER_STATUS } from "../utils/constants";
import { logger } from "../utils/logger";
import { CUSTOMER_IMAGE_TYPES, DOCUMENT_TYPES, maxBytes, parseMultipart, saveUpload } from "../lib/storage";

const CLOSED_STATUSES: string[] = [ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED];

/** Validasi token link upload dan ambil order-nya. Token salah -> 404 (tidak membocorkan apa pun). */
async function loadOrderFromToken(token: string) {
  const orderId = parseUploadToken(token);
  if (!orderId) throw new HttpError(404, "Link upload tidak valid.");
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: true,
      payments: { orderBy: { createdAt: "desc" } },
      files: { where: { type: { in: [FILE_TYPE.PREVIEW, FILE_TYPE.RESULT] } }, orderBy: { createdAt: "asc" } },
      items: { where: { label: { in: ["Catatan hasil", "Permintaan revisi"] } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) throw new HttpError(404, "Link upload tidak valid.");
  return order;
}

const PAYABLE_STATUSES: string[] = [ORDER_STATUS.WAITING_PAYMENT, ORDER_STATUS.WAITING_FINAL_PAYMENT, ORDER_STATUS.PAYMENT_REVIEW];
const MAX_REVISIONS = 5;

/** GET /api/public/upload/:token - info yang dibutuhkan halaman customer. */
/** Muat order dari token; tagihan PENDING tanpa bukti dirapikan dulu agar nominal selalu DP 50% / pelunasan yang benar. */
async function loadOrderForPayment(token: string) {
  let order = await loadOrderFromToken(token);
  if (order.price && (order.status === ORDER_STATUS.WAITING_PAYMENT || order.status === ORDER_STATUS.WAITING_FINAL_PAYMENT)) {
    await ensurePendingPayment(order.id);
    order = await loadOrderFromToken(token);
  }
  return order;
}

export async function getUploadInfo(c: AppContext) {
  const order = await loadOrderForPayment(c.req.param("token") ?? "");
  const payment = order.payments[0] ?? null;
  const closed = CLOSED_STATUSES.includes(order.status);
  const qris = await getActiveQris();
  const qrisPayload = await getQrisPayload();

  const price = order.price ?? 0;
  const split = price ? splitPrice(price) : null;
  const spec = price ? nextPaymentSpec(price, order.payments) : null;
  // Tagihan berjalan: baris terakhir yang belum lunas, atau tagihan berikutnya.
  const unpaid = payment && payment.status !== "PAID" ? payment : null;
  const paymentKind = unpaid?.kind ?? spec?.kind ?? null;
  const amountDue = unpaid?.amount ?? spec?.amount ?? null;

  const canUploadProof = !closed && Boolean(order.price) && PAYABLE_STATUSES.includes(order.status);

  const unlocked = order.status === ORDER_STATUS.COMPLETED;
  const previews = order.files.filter((f: { type: string }) => f.type === FILE_TYPE.PREVIEW).map((f: { id: number }) => ({ id: f.id }));
  const results = order.files
    .filter((f: { type: string }) => f.type === FILE_TYPE.RESULT)
    .map((f: { id: number; filename: string; size: number | null }) => ({ id: f.id, filename: f.filename, size: f.size }));
  const externalLink = order.resultUrl && /^https?:\/\//i.test(order.resultUrl) ? order.resultUrl : null;
  const resultNote = [...order.items].reverse().find((i: { label: string }) => i.label === "Catatan hasil")?.value ?? null;
  const revisionCount = order.items.filter((i: { label: string }) => i.label === "Permintaan revisi").length;

  return c.json({
    orderNumber: order.orderNumber,
    service: order.service,
    serviceLabel: serviceLabel(order.service),
    customerName: order.user.name,
    status: order.status,
    price: order.price,
    dpAmount: split?.dp ?? null,
    finalAmount: split?.final ?? null,
    paymentStatus: payment?.status ?? null,
    paymentKind,
    amountDue,
    proofUploaded: Boolean(payment?.proofFile) && payment?.status !== "REJECTED" && payment?.status !== "PAID",
    qrisUrl: qris?.url ?? null,
    // QRIS dinamis: gambar QR dibuat per tagihan dengan nominal terkunci (lihat /qris.svg)
    dynamicQris: Boolean(qrisPayload) && Boolean(amountDue) && !closed && PAYABLE_STATUSES.includes(order.status),
    closed,
    canUploadProof,
    canUploadReference: !closed,
    // ---- hasil pekerjaan ----
    hasResult: previews.length > 0 || results.length > 0 || Boolean(externalLink),
    previews, // gambar pratinjau (diambil lewat endpoint berpaksa token)
    unlocked, // true = pelunasan terkonfirmasi, tombol unduh terbuka
    results, // daftar file asli (hanya nama; isi baru bisa diunduh saat unlocked)
    externalLink: unlocked ? externalLink : null,
    hasExternalLink: Boolean(externalLink),
    resultNote,
    canRequestRevision: order.status === ORDER_STATUS.WAITING_FINAL_PAYMENT && revisionCount < MAX_REVISIONS,
    revisionCount,
    maxRevisions: MAX_REVISIONS,
  });
}

/** GET /api/public/upload/:token/preview/:fileId - gambar pratinjau (sudah ber-watermark, tidak di-cache). */
export async function getPreviewImage(c: AppContext) {
  const order = await loadOrderFromToken(c.req.param("token") ?? "");
  if (order.status === ORDER_STATUS.CANCELLED) throw new HttpError(404, "Tidak tersedia.");
  const fileId = Number(c.req.param("fileId"));
  const file = order.files.find((f: { id: number; type: string }) => f.id === fileId && f.type === FILE_TYPE.PREVIEW);
  if (!file) throw new HttpError(404, "Pratinjau tidak ditemukan.");

  const stored = await prisma.upload.findUnique({ where: { key: file.url.replace(/^\/uploads\//, "") } });
  if (!stored) throw new HttpError(404, "Pratinjau tidak ditemukan.");

  return new Response(stored.data as unknown as BodyInit, {
    headers: {
      "Content-Type": stored.mimeType || "image/jpeg",
      "Content-Disposition": "inline",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

/** GET /api/public/upload/:token/download/:fileId - file hasil asli; HANYA setelah pelunasan terkonfirmasi. */
export async function downloadResultPublic(c: AppContext) {
  const order = await loadOrderFromToken(c.req.param("token") ?? "");
  if (order.status !== ORDER_STATUS.COMPLETED) {
    throw new HttpError(403, "File masih terkunci. Selesaikan pelunasan dulu, file otomatis terbuka setelah pembayaranmu dikonfirmasi admin.");
  }
  const fileId = Number(c.req.param("fileId"));
  const file = order.files.find((f: { id: number; type: string }) => f.id === fileId && f.type === FILE_TYPE.RESULT);
  if (!file) throw new HttpError(404, "File tidak ditemukan.");

  const stored = await prisma.upload.findUnique({ where: { key: file.url.replace(/^\/uploads\//, "") } });
  if (!stored) throw new HttpError(404, "File tidak ditemukan.");

  const safeName = file.filename.replace(/[^\w.\- ]+/g, "_");
  return new Response(stored.data as unknown as BodyInit, {
    headers: {
      "Content-Type": stored.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** GET /api/public/upload/:token/qris.svg - QRIS dinamis dengan nominal tagihan berjalan (DP / pelunasan). */
export async function getQrisSvg(c: AppContext) {
  const order = await loadOrderForPayment(c.req.param("token") ?? "");
  if (CLOSED_STATUSES.includes(order.status) || !order.price) throw new HttpError(404, "QRIS tidak tersedia.");

  const payload = await getQrisPayload();
  if (!payload) throw new HttpError(404, "QRIS dinamis belum diatur admin.");

  const unpaid = order.payments[0] && order.payments[0].status !== "PAID" ? order.payments[0] : null;
  const spec = nextPaymentSpec(order.price, order.payments);
  const amount = unpaid?.amount ?? spec?.amount;
  if (!amount) throw new HttpError(404, "Tidak ada tagihan yang perlu dibayar.");

  let svg: string;
  try {
    svg = qrToSvg(makeDynamicQris(payload, amount), 360);
  } catch (err) {
    logger.error("Gagal membuat QRIS dinamis", { error: err instanceof Error ? err.message : String(err) });
    throw new HttpError(500, "QRIS dinamis gagal dibuat. Hubungi admin.");
  }
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } });
}

const revisionSchema = z.object({
  note: z.string().trim().min(5, "Jelaskan bagian yang perlu diperbaiki (minimal 5 karakter).").max(2000, "Catatan revisi maksimal 2000 karakter."),
});

/** POST /api/public/upload/:token/revision - customer menyampaikan bagian yang perlu diperbaiki (sebelum pelunasan). */
export async function requestRevisionPublic(c: AppContext) {
  const order = await loadOrderFromToken(c.req.param("token") ?? "");
  if (order.status !== ORDER_STATUS.WAITING_FINAL_PAYMENT) {
    throw new HttpError(400, "Permintaan revisi hanya bisa dikirim saat pratinjau hasil sudah tersedia dan belum dilunasi.");
  }
  const revisionCount = order.items.filter((i: { label: string }) => i.label === "Permintaan revisi").length;
  if (revisionCount >= MAX_REVISIONS) {
    throw new HttpError(400, `Batas revisi (${MAX_REVISIONS}x) sudah tercapai. Hubungi admin lewat WhatsApp ya.`);
  }

  const { note } = revisionSchema.parse(await readJson(c));

  await prisma.orderItem.create({ data: { orderId: order.id, label: "Permintaan revisi", value: note } });
  await prisma.order.update({ where: { id: order.id }, data: { status: ORDER_STATUS.PROCESSING } });
  await setState(order.user.phoneNumber, CONVERSATION_STATE.PROCESSING, {}, order.id);

  await notifyCustomer(order.user.phoneNumber, messages.revisionReceived(order.orderNumber));
  await notifyAdmins(
    messages.adminRevisionRequested({
      orderNumber: order.orderNumber,
      customerName: order.user.name ?? order.user.phoneNumber,
      note,
      adminUrl: adminOrderUrl(order.id),
    })
  );

  logger.info("Revision requested", { orderNumber: order.orderNumber, count: revisionCount + 1 });
  return c.json({ ok: true });
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

  const okStatus = PAYABLE_STATUSES.includes(order.status);
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
