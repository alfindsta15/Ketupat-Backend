/**
 * End-to-end tests for the KETUPAT bot conversation flow.
 *
 * These tests exercise the real Prisma-backed state machine (bot.engine.ts)
 * against a throwaway SQLite test database. The Fonnte network client is
 * mocked so no real WhatsApp messages are sent.
 *
 * IMPORTANT: these tests need a generated Prisma Client and a migrated
 * schema. Run:
 *   npx prisma generate
 *   DATABASE_URL="file:./prisma/test.db" npx prisma db push
 * before `npm test` (see README.md "Cara testing bot").
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/fonnte.service", () => {
  return {
    fonnteService: {
      sendText: vi.fn(async () => ({
        status: true,
        detail: "success! message in queue",
        id: ["mock-id"],
        process: "pending",
        requestid: 1,
        target: ["mock-target"],
      })),
      sendImage: vi.fn(async () => ({
        status: true,
        detail: "success! message in queue",
        id: ["mock-id"],
        process: "pending",
        requestid: 1,
        target: ["mock-target"],
      })),
      sendDocument: vi.fn(async () => ({ status: true })),
      sendSticker: vi.fn(async () => ({ status: true })),
    },
  };
});

const { fonnteService } = await import("../src/services/fonnte.service");
const { prisma } = await import("../src/lib/prisma");
const { handleIncomingMessage } = await import("../src/bot/bot.engine");
const { setOrderPrice, updateOrderStatus } = await import("../src/services/order.service");
const { submitPaymentProof, verifyPayment } = await import("../src/services/payment.service");
const { setState } = await import("../src/bot/bot.state");
const { CONVERSATION_STATE } = await import("../src/utils/constants");

const PHONE = "628111000001";

async function resetDb() {
  await prisma.review.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.quotation.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.file.deleteMany();
  await prisma.message.deleteMany();
  await prisma.order.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.user.deleteMany();
  await prisma.admin.deleteMany();
}

function lastSentText(): string {
  const calls = (fonnteService.sendText as any).mock.calls;
  return calls[calls.length - 1]?.[1] ?? "";
}

beforeAll(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

beforeEach(() => {
  (fonnteService.sendText as any).mockClear();
  (fonnteService.sendImage as any).mockClear();
});

describe("KETUPAT bot - full order lifecycle", () => {
  it("1) greets a brand new customer and shows the service menu", async () => {
    await handleIncomingMessage({ phoneNumber: PHONE, text: "Halo", messageType: "text" });

    const text = lastSentText();
    expect(text).toContain("Selamat datang di *KETUPAT*");
    expect(text).toContain("Tugas");

    const conv = await prisma.conversation.findUnique({ where: { phoneNumber: PHONE } });
    expect(conv?.state).toBe(CONVERSATION_STATE.SELECT_SERVICE);
  });

  it("2) accepts a numeric service choice and asks for the description", async () => {
    await handleIncomingMessage({ phoneNumber: PHONE, text: "2", messageType: "text" }); // PPT

    expect(lastSentText()).toContain("PPT");
    const conv = await prisma.conversation.findUnique({ where: { phoneNumber: PHONE } });
    expect(conv?.state).toBe(CONVERSATION_STATE.COLLECT_DESCRIPTION);
    expect(JSON.parse(conv!.context!).service).toBe("PPT");
  });

  it("2b) rejects an invalid service choice", async () => {
    // Roll back to SELECT_SERVICE to test the invalid-choice branch in isolation.
    await setState(PHONE, CONVERSATION_STATE.SELECT_SERVICE, {});
    await handleIncomingMessage({ phoneNumber: PHONE, text: "sembarang123", messageType: "text" });

    expect(lastSentText()).toContain("belum memahami pilihan itu");
    const conv = await prisma.conversation.findUnique({ where: { phoneNumber: PHONE } });
    expect(conv?.state).toBe(CONVERSATION_STATE.SELECT_SERVICE);

    // put it back on track for the rest of the suite
    await handleIncomingMessage({ phoneNumber: PHONE, text: "PPT", messageType: "text" });
  });

  it("3) collects the description and asks for the deadline", async () => {
    await handleIncomingMessage({
      phoneNumber: PHONE,
      text: "Bantu buatkan PPT tentang energi terbarukan, 10 slide",
      messageType: "text",
    });

    expect(lastSentText()).toContain("deadline");
    const conv = await prisma.conversation.findUnique({ where: { phoneNumber: PHONE } });
    expect(conv?.state).toBe(CONVERSATION_STATE.COLLECT_DEADLINE);
  });

  it("4) collects the deadline and asks for a reference/attachment", async () => {
    await handleIncomingMessage({ phoneNumber: PHONE, text: "30 September 2026", messageType: "text" });

    expect(lastSentText()).toContain("referensi");
    const conv = await prisma.conversation.findUnique({ where: { phoneNumber: PHONE } });
    expect(conv?.state).toBe(CONVERSATION_STATE.COLLECT_REFERENCE);
  });

  it("5) skips the reference and asks for the customer's name", async () => {
    await handleIncomingMessage({ phoneNumber: PHONE, text: "SKIP", messageType: "text" });

    expect(lastSentText()).toContain("nama kamu");
    const conv = await prisma.conversation.findUnique({ where: { phoneNumber: PHONE } });
    expect(conv?.state).toBe(CONVERSATION_STATE.COLLECT_NAME);
  });

  it("6) creates the order once the name is given, with an auto-incrementing #KTP order number", async () => {
    await handleIncomingMessage({ phoneNumber: PHONE, text: "Budi Santoso", messageType: "text" });

    const text = lastSentText();
    expect(text).toContain("Order ID: #KTP-");
    expect(text).toContain("sudah diterima");

    const order = await prisma.order.findFirst({ where: { user: { phoneNumber: PHONE } } });
    expect(order).not.toBeNull();
    expect(order!.orderNumber).toMatch(/^KTP-\d{5}$/);
    expect(order!.service).toBe("PPT");
    expect(order!.status).toBe("WAITING_QUOTATION");

    const conv = await prisma.conversation.findUnique({ where: { phoneNumber: PHONE } });
    expect(conv?.state).toBe(CONVERSATION_STATE.WAITING_ADMIN_QUOTE);
    expect(conv?.orderId).toBe(order!.id);
  });

  it("7) admin sends a quotation and the bot delivers it to the customer", async () => {
    const order = await prisma.order.findFirst({ where: { user: { phoneNumber: PHONE } } });
    const updated = await setOrderPrice(order!.id, 150000, "Harga promo mahasiswa", undefined);
    await setState(PHONE, CONVERSATION_STATE.QUOTATION_SENT, {}, updated.id);

    // Simulate the WhatsApp send the controller would do after setOrderPrice().
    const { messages } = await import("../src/bot/bot.messages");
    const text = messages.quotation({
      orderNumber: updated.orderNumber,
      serviceLabel: "PPT",
      price: 150000,
      deadline: updated.deadline ?? "-",
    });
    await fonnteService.sendText(PHONE, text);

    expect(updated.price).toBe(150000);
    expect(updated.status).toBe("WAITING_PAYMENT");
    const quotation = await prisma.quotation.findFirst({ where: { orderId: order!.id } });
    expect(quotation?.price).toBe(150000);
  });

  it("8) customer chooses LANJUT BAYAR and receives the payment instructions", async () => {
    await handleIncomingMessage({ phoneNumber: PHONE, text: "1", messageType: "text" });

    const conv = await prisma.conversation.findUnique({ where: { phoneNumber: PHONE } });
    expect(conv?.state).toBe(CONVERSATION_STATE.WAITING_PAYMENT);
    // No QRIS configured in this test -> falls back to sendText with payment info.
    expect(fonnteService.sendText).toHaveBeenCalled();
  });

  it("8b) an unrecognized quotation reply asks the customer to pick 1 or 2", async () => {
    const order = await prisma.order.findFirst({ where: { user: { phoneNumber: PHONE } } });
    await setState(PHONE, CONVERSATION_STATE.QUOTATION_SENT, {}, order!.id);
    await handleIncomingMessage({ phoneNumber: PHONE, text: "hah?", messageType: "text" });
    expect(lastSentText()).toContain("1");
    // restore
    await setState(PHONE, CONVERSATION_STATE.WAITING_PAYMENT, {}, order!.id);
  });

  it("9) customer sends a payment proof photo", async () => {
    const conv = await prisma.conversation.findUnique({ where: { phoneNumber: PHONE } });
    await handleIncomingMessage({
      phoneNumber: PHONE,
      text: "",
      messageType: "image",
      mediaLocalPath: "/uploads/incoming/mock-proof.jpg",
    });

    expect(lastSentText()).toContain("Bukti pembayaran sudah diterima");

    const payment = await prisma.payment.findFirst({ where: { orderId: conv!.orderId! } });
    expect(payment?.status).toBe("REVIEW");
    expect(payment?.proofFile).toBe("/uploads/incoming/mock-proof.jpg");

    const order = await prisma.order.findUnique({ where: { id: conv!.orderId! } });
    expect(order?.status).toBe("PAYMENT_REVIEW");

    const newConv = await prisma.conversation.findUnique({ where: { phoneNumber: PHONE } });
    expect(newConv?.state).toBe(CONVERSATION_STATE.PAYMENT_REVIEW);
  });

  it("10) admin verifies the payment and the bot confirms + moves order to PROCESSING", async () => {
    const conv = await prisma.conversation.findUnique({ where: { phoneNumber: PHONE } });
    const payment = await prisma.payment.findFirst({ where: { orderId: conv!.orderId! } });

    const admin = await prisma.admin.create({
      data: { name: "Test Admin", email: "test-admin@ketupat.id", passwordHash: "x" },
    });

    const { order } = await verifyPayment(payment!.id, admin.id);
    expect(order.status).toBe("PROCESSING");

    const updatedPayment = await prisma.payment.findUnique({ where: { id: payment!.id } });
    expect(updatedPayment?.status).toBe("PAID");
  });

  it("11) customer checks STATUS and gets the correct progress", async () => {
    await handleIncomingMessage({ phoneNumber: PHONE, text: "STATUS", messageType: "text" });

    const text = lastSentText();
    expect(text).toContain("STATUS ORDER");
    expect(text).toContain("SEDANG DIKERJAKAN");
  });

  it("12) admin marks the order for review and the bot asks for a rating", async () => {
    const conv = await prisma.conversation.findUnique({ where: { phoneNumber: PHONE } });
    await updateOrderStatus(conv!.orderId!, "REVIEW");
    await setState(PHONE, CONVERSATION_STATE.REVIEW, {}, conv!.orderId);

    await handleIncomingMessage({ phoneNumber: PHONE, text: "5 mantap, cepat banget!", messageType: "text" });

    expect(lastSentText()).toContain("Terima kasih atas feedback");

    const review = await prisma.review.findFirst({ where: { orderId: conv!.orderId! } });
    expect(review?.rating).toBe(5);
    expect(review?.feedback).toContain("mantap");

    const newConv = await prisma.conversation.findUnique({ where: { phoneNumber: PHONE } });
    expect(newConv?.state).toBe(CONVERSATION_STATE.COMPLETED);
  });

  it("12b) rejects an invalid rating", async () => {
    const conv = await prisma.conversation.findUnique({ where: { phoneNumber: PHONE } });
    await setState(PHONE, CONVERSATION_STATE.REVIEW, {}, conv!.orderId);
    await handleIncomingMessage({ phoneNumber: PHONE, text: "bagus banget tapi lupa kasih angka", messageType: "text" });
    expect(lastSentText()).toContain("angka rating 1-5");
  });

  it("13) checking status for a non-existent order id returns 'not found'", async () => {
    await handleIncomingMessage({ phoneNumber: PHONE, text: "STATUS KTP-99999", messageType: "text" });
    expect(lastSentText()).toContain("tidak ditemukan");
  });
});
