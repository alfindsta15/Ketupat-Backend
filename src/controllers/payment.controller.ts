import { z } from "zod";
import type { AppContext } from "../types";
import { prisma } from "../lib/prisma";
import { HttpError, readJson } from "../lib/http";
import { backfillPayments, rejectPaymentAndNotify, verifyPaymentAndNotify } from "../services/payment.service";

const noteSchema = z.object({ note: z.string().trim().max(2000).optional() });

/**
 * GET /api/payments?status=REVIEW
 * Payment untuk order lama yang belum punya baris Payment dibuatkan otomatis (backfill).
 */
export async function listPayments(c: AppContext) {
  await backfillPayments();

  const status = c.req.query("status") || undefined;
  const payments = await prisma.payment.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { order: { include: { user: true } } },
  });
  return c.json(payments);
}

/** POST /api/payments/:id/verify  body: { note? } */
export async function verifyPaymentController(c: AppContext) {
  const id = Number(c.req.param("id"));
  const { note } = noteSchema.parse(await readJson(c));

  const result = await verifyPaymentAndNotify(id, c.get("admin").id, note || undefined);
  if (!result) throw new HttpError(404, "Pembayaran tidak ditemukan");

  return c.json({ payment: result.payment, order: result.order, alreadyPaid: result.alreadyPaid });
}

/** POST /api/payments/:id/reject  body: { note? } */
export async function rejectPaymentController(c: AppContext) {
  const id = Number(c.req.param("id"));
  const { note } = noteSchema.parse(await readJson(c));

  const result = await rejectPaymentAndNotify(id, c.get("admin").id, note || undefined);
  if (!result) throw new HttpError(404, "Pembayaran tidak ditemukan");

  return c.json(result);
}
