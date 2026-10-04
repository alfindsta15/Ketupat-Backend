import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";

// Mock the WhatsApp gateway: we never call the real Fonnte API in tests.
const sent: { to: string; text: string; type: string }[] = [];
vi.mock("../src/services/fonnte.service", () => ({
  fonnteService: {
    sendText: vi.fn(async (to: string, text: string) => { sent.push({ to, text, type: "text" }); return { status: true }; }),
    sendImage: vi.fn(async (to: string, _u: string, caption?: string) => { sent.push({ to, text: caption ?? "", type: "image" }); return { status: true }; }),
    sendDocument: vi.fn(async () => ({ status: true })),
    sendSticker: vi.fn(async () => ({ status: true })),
  },
}));

import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { handleIncomingMessage } from "../src/bot/bot.engine";
import { hashPassword } from "../src/services/auth.service";
import { setActiveQris } from "../src/services/settings.service";

const PHONE = "628111222333";
const app = createApp();
let token = "";

const say = (text: string, extra: any = {}) =>
  handleIncomingMessage({ phoneNumber: PHONE, text, messageType: "text", ...extra });
const last = () => sent[sent.length - 1];

// Other test files share the same SQLite test DB, so start from a clean slate
// (and reset AUTOINCREMENT counters so order numbers start at KTP-00001).
async function resetDb() {
  await prisma.message.deleteMany();
  await prisma.review.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.quotation.deleteMany();
  await prisma.file.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.order.deleteMany();
  await prisma.user.deleteMany();
  await prisma.admin.deleteMany();
  await prisma.setting.deleteMany();
  try { await prisma.$executeRawUnsafe("DELETE FROM sqlite_sequence"); } catch { /* table may not exist yet */ }
}

beforeAll(async () => {
  await resetDb();
  await prisma.admin.create({
    data: { name: "Test", email: "t@ketupat.id", passwordHash: await hashPassword("secret123") },
  });
  await setActiveQris("http://localhost:4000/uploads/qris/test.png", "test.png");
  const res = await request(app).post("/api/auth/login").send({ email: "t@ketupat.id", password: "secret123" });
  token = res.body.token;
});

describe("full order lifecycle", () => {
  let orderId = 0;
  let paymentId = 0;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it("new customer says Halo -> welcome menu", async () => {
    await say("Halo");
    expect(last().text).toContain("Selamat datang di *KETUPAT*");
  });

  it("invalid service choice -> retry menu", async () => {
    await say("99");
    expect(last().text).toContain("belum memahami");
  });

  it("customer chooses service, sends description, deadline, reference, name", async () => {
    await say("PPT");
    expect(last().text).toContain("Siap! Kita bantu untuk *PPT*");
    await say("PPT 15 slide tentang AI");
    expect(last().text).toContain("deadline");
    await say("30 September 2026");
    expect(last().text).toContain("referensi");
    await say("skip");
    expect(last().text).toContain("nama");
    await say("Budi");
    expect(last().text).toContain("#KTP-00001");
    const order = await prisma.order.findFirstOrThrow({ where: { orderNumber: "KTP-00001" } });
    orderId = order.id;
    expect(order.status).toBe("WAITING_QUOTATION");
    expect(order.service).toBe("PPT");
  });

  it("order ids auto-increment without duplicates", async () => {
    const other = "628999888777";
    for (const t of ["halo", "1", "tugas math", "besok", "skip", "Sari"]) {
      await handleIncomingMessage({ phoneNumber: other, text: t, messageType: "text" });
    }
    const orders = await prisma.order.findMany({ orderBy: { id: "asc" } });
    expect(orders.map((o) => o.orderNumber)).toEqual(["KTP-00001", "KTP-00002"]);
  });

  it("admin API rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/orders");
    expect(res.status).toBe(401);
  });

  it("admin sends quotation -> customer receives it", async () => {
    const res = await request(app).post(`/api/orders/${orderId}/quotation`).set(auth()).send({ price: 150000 });
    expect(res.status).toBe(200);
    expect(last().text).toContain("QUOTATION KETUPAT");
    expect(last().text).toContain("Rp150.000");
  });

  it("customer chooses LANJUT BAYAR -> QRIS link sent as text", async () => {
    await say("1");
    expect(last().type).toBe("text");
    expect(last().text).toContain("PEMBAYARAN");
    expect(last().text).toContain("qris/test.png"); // the QRIS link set in beforeAll
  });

  it("text instead of proof -> asked to send image", async () => {
    await say("udah bayar");
    expect(last().text).toContain("foto");
  });

  it("customer sends payment proof -> PAYMENT_REVIEW", async () => {
    await say("", { messageType: "image", mediaLocalPath: "/uploads/incoming/proof.jpg" });
    expect(last().text).toContain("Bukti pembayaran sudah diterima");
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
    paymentId = payment.id;
    expect(payment.status).toBe("REVIEW");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PAYMENT_REVIEW");
  });

  it("admin verifies payment -> PAID + WhatsApp confirmation", async () => {
    const res = await request(app).post(`/api/payments/${paymentId}/verify`).set(auth());
    expect(res.status).toBe(200);
    expect(last().text).toContain("PEMBAYARAN BERHASIL");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("PAID");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PROCESSING");
  });

  it("customer checks status", async () => {
    await say("STATUS #KTP-00001");
    expect(last().text).toContain("SEDANG DIKERJAKAN");
  });

  it("admin moves to REVIEW then completion triggers review request", async () => {
    await request(app).patch(`/api/orders/${orderId}/status`).set(auth()).send({ status: "REVIEW" });
    expect(last().text).toContain("rating 1–5");
    await prisma.order.update({ where: { id: orderId }, data: { status: "COMPLETED", resultUrl: "http://x/y.pdf" } });
  });

  it("invalid rating rejected, valid rating saved", async () => {
    await say("bagus");
    expect(last().text).toContain("rating");
    await say("5 mantap!");
    const review = await prisma.review.findUniqueOrThrow({ where: { orderId } });
    expect(review.rating).toBe(5);
    expect(review.feedback).toBe("mantap!");
  });
});

describe("webhook", () => {
  it("returns 400 for invalid payload", async () => {
    const res = await request(app).post("/webhook/fonnte").send({ foo: "bar" });
    expect(res.status).toBe(400);
  });
  it("returns 200 for valid text payload", async () => {
    const res = await request(app).post("/webhook/fonnte").send({ sender: "0811222333", message: "halo" });
    expect(res.status).toBe(200);
  });
});

describe("Konsultasi (free service) skips quotation/payment", () => {
  const PHONE2 = "628555000111";
  const say2 = (text: string) => handleIncomingMessage({ phoneNumber: PHONE2, text, messageType: "text" });

  it("goes straight from description to name, no deadline/reference asked", async () => {
    await say2("halo");
    await say2("konsultasi");
    expect(last().text).toContain("Konsultasi");
    await say2("Mau nanya-nanya dulu boleh?");
    // Should ask for the name directly (deadline/reference steps are skipped).
    expect(last().text).toContain("nama kamu");
    await say2("Rina");
    expect(last().text).toContain("FREE");
    const order = await prisma.order.findFirstOrThrow({ where: { user: { phoneNumber: PHONE2 } } });
    expect(order.service).toBe("KONSULTASI");
    expect(order.status).toBe("PROCESSING");
    expect(order.price).toBeNull();
  });
});

describe("QRIS via manual link", () => {
  it("admin can set QRIS from a pasted link", async () => {
    const token2 = (await request(app).post("/api/auth/login").send({ email: "t@ketupat.id", password: "secret123" })).body.token;
    const res = await request(app)
      .post("/api/settings/qris/link")
      .set("Authorization", `Bearer ${token2}`)
      .send({ url: "https://example.com/qris-ketupat.png" });
    expect(res.status).toBe(200);
    const check = await request(app).get("/api/settings/qris").set("Authorization", `Bearer ${token2}`);
    expect(check.body.url).toBe("https://example.com/qris-ketupat.png");
  });

  it("rejects an invalid (non-URL) link", async () => {
    const token2 = (await request(app).post("/api/auth/login").send({ email: "t@ketupat.id", password: "secret123" })).body.token;
    const res = await request(app)
      .post("/api/settings/qris/link")
      .set("Authorization", `Bearer ${token2}`)
      .send({ url: "not-a-url" });
    expect(res.status).toBe(400);
  });
});