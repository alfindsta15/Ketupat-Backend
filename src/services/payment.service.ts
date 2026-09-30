import { prisma } from "../lib/prisma";
import { ORDER_STATUS, PAYMENT_STATUS } from "../utils/constants";
import { logger } from "../utils/logger";

/** Creates (or reuses) a pending payment row for an order and attaches a proof file. */
export async function submitPaymentProof(orderId: number, proofFilePath: string) {
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
      data: {
        orderId,
        amount: order.price ?? 0,
        proofFile: proofFilePath,
        status: PAYMENT_STATUS.REVIEW,
      },
    });
  }

  await prisma.order.update({ where: { id: orderId }, data: { status: ORDER_STATUS.PAYMENT_REVIEW } });
  logger.info("Payment proof uploaded", { orderId, paymentId: payment.id });
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
    data: { status: PAYMENT_STATUS.REJECTED },
  });
  const order = await prisma.order.update({
    where: { id: payment.orderId },
    data: { status: ORDER_STATUS.WAITING_PAYMENT },
  });
  logger.info("Payment rejected", { orderId: order.id, adminId });
  return { payment, order };
}
