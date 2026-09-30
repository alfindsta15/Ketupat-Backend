import { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { AuthedRequest } from "../middleware/auth.middleware";
import { HttpError } from "../middleware/error.middleware";
import { env } from "../config/env";
import { setOrderPrice, updateOrderStatus } from "../services/order.service";
import { setState } from "../bot/bot.state";
import { messages, formatRupiah } from "../bot/bot.messages";
import { serviceLabel } from "../bot/bot.handlers";
import { fonnteService } from "../services/fonnte.service";
import { CONVERSATION_STATE, ORDER_STATUS, FILE_TYPE } from "../utils/constants";
import { logger } from "../utils/logger";
import { maybeSendSticker } from "../utils/sticker";

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

export const listOrders = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const q = listQuerySchema.parse(req.query);

  const where: any = {};
  if (q.status) where.status = q.status;
  if (q.paymentStatus) where.payments = { some: { status: q.paymentStatus } };
  if (q.search) {
    where.OR = [
      { orderNumber: { contains: q.search } },
      { description: { contains: q.search } },
      { user: { name: { contains: q.search } } },
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

  res.json({
    data: orders,
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
  });
});

// ---------------------------------------------------------------------------
// GET /api/orders/:id - full detail
// ---------------------------------------------------------------------------
export const getOrder = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      user: true,
      items: true,
      files: true,
      payments: { include: { admin: { select: { id: true, name: true } } } },
      quotations: true,
      review: true,
    },
  });
  if (!order) throw new HttpError(404, "Order tidak ditemukan");

  const messagesLog = await prisma.message.findMany({
    where: { phoneNumber: order.user.phoneNumber },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  res.json({ ...order, messages: messagesLog });
});

// ---------------------------------------------------------------------------
// POST /api/orders/:id/quotation - set price & send quotation via WhatsApp
// ---------------------------------------------------------------------------
const quotationSchema = z.object({
  price: z.coerce.number().positive(),
  note: z.string().optional(),
});

export const createQuotation = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const { price, note } = quotationSchema.parse(req.body);

  const existing = await prisma.order.findUnique({ where: { id }, include: { user: true } });
  if (!existing) throw new HttpError(404, "Order tidak ditemukan");

  const order = await setOrderPrice(id, price, note, req.admin!.id);

  await setState(existing.user.phoneNumber, CONVERSATION_STATE.QUOTATION_SENT, {}, order.id);

  const text = messages.quotation({
    orderNumber: order.orderNumber,
    serviceLabel: serviceLabel(order.service),
    price,
    deadline: order.deadline ?? "-",
  });
  await prisma.message.create({ data: { phoneNumber: existing.user.phoneNumber, direction: "OUT", message: text } });
  await fonnteService.sendText(existing.user.phoneNumber, text);

  res.json(order);
});

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/status - manual status change (with side-effect WA messages)
// ---------------------------------------------------------------------------
const statusSchema = z.object({
  status: z.enum([
    "WAITING_BRIEF",
    "WAITING_QUOTATION",
    "WAITING_PAYMENT",
    "PAYMENT_REVIEW",
    "PAID",
    "PROCESSING",
    "REVIEW",
    "COMPLETED",
    "CANCELLED",
  ]),
});

export const changeOrderStatus = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const { status } = statusSchema.parse(req.body);

  const existing = await prisma.order.findUnique({ where: { id }, include: { user: true } });
  if (!existing) throw new HttpError(404, "Order tidak ditemukan");

  const order = await updateOrderStatus(id, status);

  if (status === ORDER_STATUS.COMPLETED) {
    const done = messages.completed({ orderNumber: order.orderNumber, resultUrl: order.resultUrl });
    await prisma.message.create({ data: { phoneNumber: existing.user.phoneNumber, direction: "OUT", message: done } });
    await fonnteService.sendText(existing.user.phoneNumber, done);
    await maybeSendSticker(existing.user.phoneNumber, env.stickers.completed);
    await setState(existing.user.phoneNumber, CONVERSATION_STATE.REVIEW, {}, order.id);
    await prisma.message.create({ data: { phoneNumber: existing.user.phoneNumber, direction: "OUT", message: messages.askReview() } });
    await fonnteService.sendText(existing.user.phoneNumber, messages.askReview());
  }

  if (status === ORDER_STATUS.REVIEW) {
    await setState(existing.user.phoneNumber, CONVERSATION_STATE.REVIEW, {}, order.id);
    await prisma.message.create({
      data: { phoneNumber: existing.user.phoneNumber, direction: "OUT", message: messages.askReview() },
    });
    await fonnteService.sendText(existing.user.phoneNumber, messages.askReview());
  }

  res.json(order);
});

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/note - internal admin note (not sent to customer)
// ---------------------------------------------------------------------------
const noteSchema = z.object({ adminNote: z.string().max(2000) });

export const updateOrderNote = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const { adminNote } = noteSchema.parse(req.body);
  const order = await prisma.order.update({ where: { id }, data: { adminNote } });
  res.json(order);
});

// ---------------------------------------------------------------------------
// POST /api/orders/:id/message - free-text message from admin to customer
// ---------------------------------------------------------------------------
const messageSchema = z.object({ message: z.string().min(1).max(4000) });

export const sendCustomerMessage = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const { message } = messageSchema.parse(req.body);

  const order = await prisma.order.findUnique({ where: { id }, include: { user: true } });
  if (!order) throw new HttpError(404, "Order tidak ditemukan");

  await prisma.message.create({ data: { phoneNumber: order.user.phoneNumber, direction: "OUT", message } });
  const result = await fonnteService.sendText(order.user.phoneNumber, message);

  res.json({ sent: result.status === true, result });
});

// ---------------------------------------------------------------------------
// POST /api/orders/:id/result - upload final work file & mark COMPLETED
// ---------------------------------------------------------------------------
export const uploadOrderResult = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw new HttpError(400, "File hasil wajib diupload");

  const order = await prisma.order.findUnique({ where: { id }, include: { user: true } });
  if (!order) throw new HttpError(404, "Order tidak ditemukan");

  const relativePath = `/uploads/results/${file.filename}`;
  const publicUrl = toPublicUrl(relativePath);

  await prisma.file.create({
    data: {
      orderId: id,
      type: FILE_TYPE.RESULT,
      url: relativePath,
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      uploadedBy: "ADMIN",
    },
  });

  const updated = await prisma.order.update({
    where: { id },
    data: { resultUrl: publicUrl, status: ORDER_STATUS.COMPLETED },
  });

  const completedText = messages.completed({ orderNumber: updated.orderNumber, resultUrl: publicUrl });
  await prisma.message.create({ data: { phoneNumber: order.user.phoneNumber, direction: "OUT", message: completedText } });
  await fonnteService.sendText(order.user.phoneNumber, completedText);
  await maybeSendSticker(order.user.phoneNumber, env.stickers.completed);

  // Immediately follow up asking for a review, per the KETUPAT flow.
  await setState(order.user.phoneNumber, CONVERSATION_STATE.REVIEW, {}, updated.id);
  await prisma.message.create({ data: { phoneNumber: order.user.phoneNumber, direction: "OUT", message: messages.askReview() } });
  await fonnteService.sendText(order.user.phoneNumber, messages.askReview());

  logger.info("Order marked completed", { orderNumber: updated.orderNumber });

  res.json(updated);
});

export const listReviews = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const reviews = await prisma.review.findMany({
    include: { order: { select: { orderNumber: true, service: true, userId: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(reviews);
});
