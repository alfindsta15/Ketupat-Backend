import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { formatOrderNumber, parseOrderNumber } from "../utils/orderNumber";
import { ORDER_STATUS } from "../utils/constants";
import { logger } from "../utils/logger";

export interface CreateOrderInput {
  phoneNumber: string;
  customerName: string;
  service: string;
  description: string;
  deadline: string;
  reference?: string;
}

/**
 * Creates a new order and stamps it with an auto-incrementing, collision-free
 * order number (#KTP-00001, #KTP-00002, ...). Uses the DB's own autoincrement
 * primary key as the source of truth so two concurrent orders can never get
 * the same number.
 */
export async function createOrder(input: CreateOrderInput) {
  const user = await prisma.user.upsert({
    where: { phoneNumber: input.phoneNumber },
    update: { name: input.customerName || undefined },
    create: { phoneNumber: input.phoneNumber, name: input.customerName },
  });

  const order = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // "Konsultasi" is free: it skips quotation/payment entirely and goes
    // straight to a real admin, so it starts life already in PROCESSING.
    const initialStatus = input.service === "KONSULTASI" ? ORDER_STATUS.PROCESSING : ORDER_STATUS.WAITING_QUOTATION;

    const created = await tx.order.create({
      data: {
        // Temporary placeholder; replaced right below using the real id.
        orderNumber: `TEMP-${Date.now()}`,
        userId: user.id,
        service: input.service,
        description: input.description,
        deadline: input.deadline,
        status: initialStatus,
      },
    });

    const orderNumber = formatOrderNumber(created.id);

    return tx.order.update({
      where: { id: created.id },
      data: { orderNumber },
    });
  });

  if (input.reference) {
    await prisma.orderItem.create({
      data: { orderId: order.id, label: "Referensi", value: input.reference },
    });
  }

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

export async function setOrderPrice(
  orderId: number,
  price: number,
  note?: string,
  adminId?: number
) {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.update({
      where: { id: orderId },
      data: {
        price,
        status: ORDER_STATUS.WAITING_PAYMENT,
        adminNote: note,
      },
    });

    await tx.quotation.create({
      data: {
        orderId,
        price,
        note,
        createdBy: adminId,
      },
    });

    // Buat payment sejak order masuk tahap pembayaran.
    // Jika sudah ada payment aktif, jangan membuat duplikat.
    const existingPayment = await tx.payment.findFirst({
      where: {
        orderId,
        status: {
          in: ["PENDING", "REVIEW"],
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!existingPayment) {
      await tx.payment.create({
        data: {
          orderId,
          amount: price,
          status: "PENDING",
        },
      });
    } else {
      await tx.payment.update({
        where: { id: existingPayment.id },
        data: { amount: price },
      });
    }

    return order;
  });

  logger.info("Quotation created", {
    orderNumber: result.orderNumber,
    price,
  });

  return result;
}