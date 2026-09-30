import { Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { AuthedRequest } from "../middleware/auth.middleware";
import { HttpError } from "../middleware/error.middleware";
import { verifyPayment, rejectPayment } from "../services/payment.service";
import { messages } from "../bot/bot.messages";
import { fonnteService } from "../services/fonnte.service";
import { maybeSendSticker } from "../utils/sticker";
import { env } from "../config/env";

export const listPayments = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const payments = await prisma.payment.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: { order: { include: { user: true } } },
  });
  res.json(payments);
});

export const verifyPaymentController = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const existing = await prisma.payment.findUnique({ where: { id }, include: { order: { include: { user: true } } } });
  if (!existing) throw new HttpError(404, "Pembayaran tidak ditemukan");

  const { payment, order } = await verifyPayment(id, req.admin!.id);

  const text = messages.paymentVerified({ orderNumber: order.orderNumber, amount: payment.amount });
  await prisma.message.create({ data: { phoneNumber: existing.order.user.phoneNumber, direction: "OUT", message: text } });
  await fonnteService.sendText(existing.order.user.phoneNumber, text);
  await maybeSendSticker(existing.order.user.phoneNumber, env.stickers.paymentVerified);

  res.json({ payment, order });
});

export const rejectPaymentController = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const existing = await prisma.payment.findUnique({ where: { id }, include: { order: { include: { user: true } } } });
  if (!existing) throw new HttpError(404, "Pembayaran tidak ditemukan");

  const { payment, order } = await rejectPayment(id, req.admin!.id);

  const text =
    `⚠️ *PEMBAYARAN BELUM SESUAI*\n\nOrder: #${order.orderNumber}\n\n` +
    `Bukti pembayaran yang kamu kirim belum bisa kami verifikasi. Mohon kirim ulang bukti pembayaran yang jelas dan sesuai nominal invoice ya 🙏`;
  await prisma.message.create({ data: { phoneNumber: existing.order.user.phoneNumber, direction: "OUT", message: text } });
  await fonnteService.sendText(existing.order.user.phoneNumber, text);

  res.json({ payment, order });
});
