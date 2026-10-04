import { Prisma } from "../lib/prisma";
import { prisma } from "../lib/prisma";
import { formatOrderNumber, parseOrderNumber } from "../utils/orderNumber";
import { CONVERSATION_STATE, ORDER_STATUS, PAYMENT_STATUS } from "../utils/constants";
import { logger } from "../utils/logger";
import { env } from "../config/env";
import { messages } from "../bot/bot.messages";
import { resetState, setState } from "../bot/bot.state";
import { HttpError } from "../middleware/error.middleware";
import { notifyCustomer } from "./notification.service";
import { buildUploadUrl } from "./upload-link.service";
import { ensurePendingPayment, markActivePaymentPaid } from "./payment.service";
import { getActiveQris } from "./settings.service";
import { maybeSendSticker } from "../utils/sticker";

export interface CreateOrderInput {
  phoneNumber: string;
  customerName: string;
  service: string;
  description: string;
  deadline: string;
  reference?: string;
  /** Jawaban pertanyaan detail per layanan (tampil di dashboard admin). */
  details?: { label: string; value: string }[];
}

/**
 * Creates a new order and stamps it with an auto-incrementing, collision-free
 * order number (#KTP-00001, ...). Uses the DB's own autoincrement primary key.
 */
export async function createOrder(input: CreateOrderInput) {
  const user = await prisma.user.upsert({
    where: { phoneNumber: input.phoneNumber },
    update: { name: input.customerName || undefined },
    create: { phoneNumber: input.phoneNumber, name: input.customerName },
  });

  const order = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const initialStatus = input.service === "KONSULTASI" ? ORDER_STATUS.PROCESSING : ORDER_STATUS.WAITING_QUOTATION;

    const created = await tx.order.create({
      data: {
        orderNumber: `TEMP-${Date.now()}`,
        userId: user.id,
        service: input.service,
        description: input.description,
        deadline: input.deadline,
        status: initialStatus,
      },
    });

    return tx.order.update({
      where: { id: created.id },
      data: { orderNumber: formatOrderNumber(created.id) },
    });
  });

  const items: { orderId: number; label: string; value: string }[] = [];
  for (const d of input.details ?? []) {
    if (d.value?.trim()) items.push({ orderId: order.id, label: d.label, value: d.value.trim() });
  }
  if (input.reference) items.push({ orderId: order.id, label: "Referensi", value: input.reference });
  if (items.length) await prisma.orderItem.createMany({ data: items });

  logger.info("Order created", { orderNumber: order.orderNumber, service: order.service });
  return order;
}

export async function findOrderByOrderNumber(orderNumberOrHash: string) {
  const id = parseOrderNumber(orderNumberOrHash);
  if (id === null) return null;
  return prisma.order.findUnique({
    where: { id },
    include: { user: true, payments: true, quotations: true, files: true, review: true },
  });
}

export async function findLatestOrderForPhone(phoneNumber: string) {
  return prisma.order.findFirst({
    where: { user: { phoneNumber } },
    orderBy: { createdAt: "desc" },
    include: { payments: true, quotations: true },
  });
}

export async function updateOrderStatus(orderId: number, status: string) {
  const order = await prisma.order.update({ where: { id: orderId }, data: { status } });
  logger.info("Order status changed", { orderNumber: order.orderNumber, status });
  return order;
}

export async function setOrderPrice(orderId: number, price: number, note?: string, adminId?: number) {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.update({
      where: { id: orderId },
      data: { price, status: ORDER_STATUS.WAITING_PAYMENT, adminNote: note },
    });

    await tx.quotation.create({ data: { orderId, price, note, createdBy: adminId } });

    const existingPayment = await tx.payment.findFirst({
      where: { orderId, status: { in: ["PENDING", "REVIEW"] } },
      orderBy: { createdAt: "desc" },
    });

    if (!existingPayment) {
      await tx.payment.create({ data: { orderId, amount: price, status: "PENDING" } });
    } else {
      await tx.payment.update({ where: { id: existingPayment.id }, data: { amount: price } });
    }

    return order;
  });

  logger.info("Quotation created", { orderNumber: result.orderNumber, price });
  return result;
}

/**
 * Admin mengubah status order dari dashboard web.
 * Semua perubahan status sekarang:
 *   1. menyinkronkan status Payment (agar menu Payments & filter "terbayar" benar),
 *   2. menyinkronkan state percakapan bot (agar balasan bot sesuai kondisi order),
 *   3. mengirim pesan WhatsApp otomatis ke customer.
 */
export async function changeOrderStatusWithNotify(orderId: number, status: string, adminId?: number) {
  const existing = await prisma.order.findUnique({ where: { id: orderId }, include: { user: true } });
  if (!existing) throw new HttpError(404, "Order tidak ditemukan");
  if (existing.status === status) return { order: existing, changed: false };

  if (status === ORDER_STATUS.WAITING_PAYMENT && !existing.price) {
    throw new HttpError(400, "Harga belum diisi. Kirim Quotation dulu sebelum mengubah ke WAITING PAYMENT.");
  }

  const order = await updateOrderStatus(orderId, status);
  const phone = existing.user.phoneNumber;

  switch (status) {
    case ORDER_STATUS.WAITING_QUOTATION: {
      await setState(phone, CONVERSATION_STATE.WAITING_ADMIN_QUOTE, {}, order.id);
      await notifyCustomer(phone, messages.statusWaitingQuotation(order.orderNumber));
      break;
    }

    case ORDER_STATUS.WAITING_PAYMENT: {
      await ensurePendingPayment(order.id);
      await setState(phone, CONVERSATION_STATE.WAITING_PAYMENT, {}, order.id);
      const qris = await getActiveQris();
      await notifyCustomer(
        phone,
        messages.payment({
          orderNumber: order.orderNumber,
          total: order.price ?? 0,
          qrisUrl: qris?.url,
          uploadUrl: buildUploadUrl(order.id),
        })
      );
      break;
    }

    case ORDER_STATUS.PAYMENT_REVIEW: {
      await prisma.payment.updateMany({
        where: { orderId: order.id, status: PAYMENT_STATUS.PENDING },
        data: { status: PAYMENT_STATUS.REVIEW },
      });
      await setState(phone, CONVERSATION_STATE.PAYMENT_REVIEW, {}, order.id);
      await notifyCustomer(phone, messages.statusPaymentReview(order.orderNumber));
      break;
    }

    case ORDER_STATUS.PAID:
    case ORDER_STATUS.PROCESSING: {
      const paid = await markActivePaymentPaid(order.id, adminId);
      await setState(phone, CONVERSATION_STATE.PROCESSING, {}, order.id);
      if (paid) {
        await notifyCustomer(
          phone,
          messages.paymentVerified({ orderNumber: order.orderNumber, amount: paid.amount || order.price || 0 })
        );
        await maybeSendSticker(phone, env.stickers.paymentVerified);
      } else if (status === ORDER_STATUS.PAID) {
        await notifyCustomer(
          phone,
          messages.paymentVerified({ orderNumber: order.orderNumber, amount: order.price ?? 0 })
        );
      } else {
        await notifyCustomer(phone, messages.statusProcessing(order.orderNumber));
      }
      break;
    }

    case ORDER_STATUS.REVIEW: {
      await setState(phone, CONVERSATION_STATE.REVIEW, {}, order.id);
      await notifyCustomer(phone, messages.askReview());
      break;
    }

    case ORDER_STATUS.COMPLETED: {
      await notifyCustomer(phone, messages.completed({ orderNumber: order.orderNumber, resultUrl: order.resultUrl }));
      await maybeSendSticker(phone, env.stickers.completed);
      await setState(phone, CONVERSATION_STATE.REVIEW, {}, order.id);
      await notifyCustomer(phone, messages.askReview());
      break;
    }

    case ORDER_STATUS.CANCELLED: {
      await resetState(phone, CONVERSATION_STATE.SELECT_SERVICE, null);
      await notifyCustomer(phone, messages.statusCancelled(order.orderNumber));
      break;
    }

    default:
      break;
  }

  return { order, changed: true };
}
