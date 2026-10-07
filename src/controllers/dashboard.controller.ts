import type { AppContext } from "../types";
import { prisma } from "../lib/prisma";
import { ORDER_STATUS, PAYMENT_STATUS } from "../utils/constants";

export async function getStats(c: AppContext) {
  const [totalOrders, pendingPayment, processing, completed, paidPayments, byService] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: { status: { in: [ORDER_STATUS.WAITING_PAYMENT, ORDER_STATUS.PAYMENT_REVIEW, ORDER_STATUS.WAITING_FINAL_PAYMENT] } } }),
    prisma.order.count({ where: { status: ORDER_STATUS.PROCESSING } }),
    prisma.order.count({ where: { status: ORDER_STATUS.COMPLETED } }),
    prisma.payment.findMany({ where: { status: PAYMENT_STATUS.PAID }, select: { amount: true } }),
    prisma.order.groupBy({ by: ["service"], _count: { _all: true } }),
  ]);

  const revenue = paidPayments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);

  return c.json({
    totalOrders,
    pendingPayment,
    processing,
    completed,
    revenue,
    byService: byService.map((s: { service: string; _count: { _all: number } }) => ({ service: s.service, count: s._count._all })),
  });
}

export async function listCustomers(c: AppContext) {
  const search = c.req.query("search") || undefined;

  const users = await prisma.user.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { phoneNumber: { contains: search } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { orders: true } }, orders: { select: { price: true, status: true } } },
  });

  const data = users.map((u: any) => ({
    id: u.id,
    name: u.name,
    phoneNumber: u.phoneNumber,
    totalOrders: u._count.orders,
    totalSpent: u.orders
      .filter((o: { status: string }) => o.status === "COMPLETED" || o.status === "PROCESSING" || o.status === "REVIEW")
      .reduce((sum: number, o: { price: number | null }) => sum + (o.price ?? 0), 0),
    createdAt: u.createdAt,
  }));

  return c.json(data);
}
