import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";
import { messages, statusLabel } from "./bot.messages";
import { getServiceProfile } from "./bot.services";
import {
  ensureUser,
  getOrCreateConversation,
  readContext,
  resetState,
  setState,
} from "./bot.state";
import {
  parseGlobalCommand,
  parseQuotationChoice,
  parseServiceChoice,
  parseRating,
  isSkip,
  serviceLabel,
} from "./bot.handlers";
import { createOrder } from "../services/order.service";
import { ensurePendingPayment } from "../services/payment.service";
import { getActiveQris } from "../services/settings.service";
import { fonnteService } from "../services/fonnte.service";
import { buildUploadUrl } from "../services/upload-link.service";
import { CONVERSATION_STATE, ORDER_STATUS } from "../utils/constants";
import { parseOrderNumber } from "../utils/orderNumber";
import { env } from "../config/env";
import { maybeSendSticker } from "../utils/sticker";

export interface IncomingWhatsAppMessage {
  phoneNumber: string; // already normalized
  text: string;
  messageType: "text" | "image" | "document" | "location" | "other";
  hasAttachment?: boolean;
  mediaLocalPath?: string | null;
  mediaRemoteUrl?: string | null;
  senderName?: string;
}

const S = CONVERSATION_STATE;

/** State di mana customer sudah punya order berjalan. */
const ACTIVE_ORDER_STATES: string[] = [
  S.WAITING_ADMIN_QUOTE,
  S.QUOTATION_SENT,
  S.WAITING_PAYMENT,
  S.PAYMENT_REVIEW,
  S.PROCESSING,
  S.REVIEW,
];

/** Bila customer mengirim file lewat chat di state ini, arahkan ke link upload. */
const UPLOAD_LINK_STATES: string[] = [
  S.WAITING_ADMIN_QUOTE,
  S.QUOTATION_SENT,
  S.WAITING_PAYMENT,
  S.PAYMENT_REVIEW,
  S.PROCESSING,
];

async function logMessage(phoneNumber: string, direction: "IN" | "OUT", message: string, messageType = "text") {
  try {
    await prisma.message.create({ data: { phoneNumber, direction, message, messageType } });
  } catch (err) {
    logger.error("Failed to persist message log", { error: err instanceof Error ? err.message : String(err) });
  }
}

async function reply(phoneNumber: string, text: string) {
  await logMessage(phoneNumber, "OUT", text, "text");
  await fonnteService.sendText(phoneNumber, text);
}

function isMedia(input: IncomingWhatsAppMessage): boolean {
  return Boolean(input.hasAttachment) || ["image", "document", "other"].includes(input.messageType);
}

/** Ping admin untuk konsultasi gratis. */
async function notifyAdminOfConsultation(customerName: string, phoneNumber: string, description: string) {
  if (!env.adminWhatsappNumber) {
    logger.warn("ADMIN_WHATSAPP_NUMBER belum diisi - notifikasi konsultasi tidak terkirim");
    return;
  }
  const text =
    `🔔 *KONSULTASI BARU*\n\n` +
    `Nama: ${customerName}\n` +
    `WhatsApp: ${phoneNumber}\n\n` +
    `Pertanyaan:\n${description}\n\n` +
    `Gas langsung chat customer ini di WhatsApp ya, Min! 🙌`;
  await fonnteService.sendText(env.adminWhatsappNumber, text);
}

/** Ping admin untuk order berat (coding/website/mobile app) yang perlu direview. */
async function notifyAdminOfHeavyOrder(orderNumber: string, service: string, customerName: string, phoneNumber: string) {
  if (!env.adminWhatsappNumber) return;
  const text =
    `🧩 *ORDER PERLU REVIEW*\n\n` +
    `#${orderNumber} • ${serviceLabel(service)}\n` +
    `Nama: ${customerName}\nWhatsApp: ${phoneNumber}\n\n` +
    `Buka dashboard admin → Orders untuk cek brief teknis & kirim quotation.`;
  await fonnteService.sendText(env.adminWhatsappNumber, text);
}

async function sendStatusForOrder(phoneNumber: string, orderId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!order) {
    await reply(phoneNumber, messages.orderNotFound());
    return;
  }
  await reply(
    phoneNumber,
    messages.statusReport({
      orderNumber: order.orderNumber,
      status: order.status,
      statusLabel: statusLabel(order.status),
      price: order.price,
      paymentStatus: order.payments[0]?.status ?? null,
    })
  );
}

/**
 * Order di database adalah sumber kebenaran. Bila admin mengubah status lewat
 * web (atau data lama tidak sinkron), state percakapan bot dikoreksi di sini
 * supaya balasan bot selalu sesuai kondisi order yang sebenarnya.
 */
const EXPECTED_STATES: Record<string, string[]> = {
  WAITING_QUOTATION: [S.WAITING_ADMIN_QUOTE],
  WAITING_PAYMENT: [S.QUOTATION_SENT, S.WAITING_PAYMENT],
  PAYMENT_REVIEW: [S.PAYMENT_REVIEW],
  PAID: [S.PROCESSING],
  PROCESSING: [S.PROCESSING],
  REVIEW: [S.REVIEW],
  COMPLETED: [S.REVIEW, S.COMPLETED],
};

async function syncConversationWithOrder<T extends { state: string; orderId: number | null; phoneNumber: string }>(
  conversation: T
): Promise<string> {
  if (!conversation.orderId) return conversation.state;
  const order = await prisma.order.findUnique({ where: { id: conversation.orderId } });
  if (!order) return conversation.state;

  if (order.status === ORDER_STATUS.CANCELLED) {
    await resetState(conversation.phoneNumber, S.SELECT_SERVICE, null);
    return S.SELECT_SERVICE;
  }

  const expected = EXPECTED_STATES[order.status];
  if (!expected || expected.includes(conversation.state)) return conversation.state;

  const target = order.status === ORDER_STATUS.WAITING_PAYMENT ? S.WAITING_PAYMENT : expected[0];
  await setState(conversation.phoneNumber, target);
  logger.info("Conversation state re-synced with order", {
    phoneNumber: conversation.phoneNumber,
    from: conversation.state,
    to: target,
    orderStatus: order.status,
  });
  return target;
}

/** Kirim info pembayaran (QRIS + link upload bukti). */
async function sendPaymentInstructions(phoneNumber: string, orderId: number) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    await reply(phoneNumber, messages.noActiveOrder());
    return;
  }
  await ensurePendingPayment(order.id);
  const qris = await getActiveQris();
  await reply(
    phoneNumber,
    messages.payment({
      orderNumber: order.orderNumber,
      total: order.price ?? 0,
      qrisUrl: qris?.url,
      uploadUrl: buildUploadUrl(order.id),
    })
  );
  if (!qris) await reply(phoneNumber, messages.paymentNoQris());
}

/**
 * Main entry point: routes one incoming WhatsApp message through the bot's
 * state machine and produces the appropriate reply/replies.
 */
export async function handleIncomingMessage(input: IncomingWhatsAppMessage): Promise<void> {
  const { phoneNumber } = input;
  const text = (input.text ?? "").trim();
  const media = isMedia(input);

  const user = await ensureUser(phoneNumber);
  await logMessage(phoneNumber, "IN", text || `[${input.messageType}]`, input.messageType);

  const conversation = await getOrCreateConversation(phoneNumber);
  const ctx = readContext(conversation);
  const state = await syncConversationWithOrder(conversation);
  const knownName = user.name ?? input.senderName ?? null;

  // ---- 1. Side-flow: menunggu Order ID untuk cek status ----
  if (ctx.pendingStatusLookup) {
    const orderId = parseOrderNumber(text);
    await setState(phoneNumber, state, { pendingStatusLookup: undefined });
    if (orderId === null) {
      await reply(phoneNumber, messages.orderNotFound());
      return;
    }
    const order = await prisma.order.findFirst({ where: { id: orderId, user: { phoneNumber } } });
    if (!order) {
      await reply(phoneNumber, messages.orderNotFound());
      return;
    }
    await sendStatusForOrder(phoneNumber, order.id);
    return;
  }

  // ---- 2. Global commands ----
  const globalCommand = parseGlobalCommand(text);

  if (globalCommand === "RESTART") {
    await resetState(phoneNumber, S.SELECT_SERVICE, null);
    await reply(phoneNumber, messages.welcome(knownName));
    return;
  }

  if (globalCommand === "GREETING") {
    if (conversation.orderId && ACTIVE_ORDER_STATES.includes(state)) {
      const active = await prisma.order.findUnique({ where: { id: conversation.orderId } });
      if (active) {
        await reply(
          phoneNumber,
          messages.greetingWithActiveOrder({
            name: knownName,
            orderNumber: active.orderNumber,
            statusLabel: statusLabel(active.status),
          })
        );
        return;
      }
    }
    await resetState(phoneNumber, S.SELECT_SERVICE, null);
    await reply(phoneNumber, messages.welcome(knownName));
    return;
  }

  if (globalCommand === "STATUS") {
    const maybeOrderId = parseOrderNumber(text);
    if (maybeOrderId !== null) {
      await sendStatusForOrder(phoneNumber, maybeOrderId);
      return;
    }

    const orders = await prisma.order.findMany({ where: { user: { phoneNumber } }, orderBy: { createdAt: "desc" } });
    if (orders.length === 0) {
      await reply(phoneNumber, messages.noActiveOrder());
      return;
    }
    if (orders.length === 1) {
      await sendStatusForOrder(phoneNumber, orders[0].id);
      return;
    }
    await setState(phoneNumber, state, { pendingStatusLookup: true });
    await reply(phoneNumber, messages.askOrderIdForStatus());
    return;
  }

  // ---- 3. File dikirim lewat chat -> arahkan ke link upload khusus ----
  if (media && conversation.orderId && UPLOAD_LINK_STATES.includes(state)) {
    const purpose = state === S.WAITING_PAYMENT || state === S.PAYMENT_REVIEW || state === S.QUOTATION_SENT ? "proof" : "reference";
    await reply(phoneNumber, messages.useUploadLink(buildUploadUrl(conversation.orderId), purpose));
    return;
  }

  // ---- 4. Route berdasarkan state ----
  switch (state) {
    case S.WELCOME: {
      await resetState(phoneNumber, S.SELECT_SERVICE, null);
      await reply(phoneNumber, messages.welcome(knownName));
      return;
    }

    case S.SELECT_SERVICE: {
      const service = parseServiceChoice(text);
      if (!service) {
        await reply(phoneNumber, messages.invalidServiceChoice());
        return;
      }
      await setState(phoneNumber, S.COLLECT_DESCRIPTION, {
        service,
        description: undefined,
        details: [],
        detailIndex: 0,
        deadline: undefined,
        reference: undefined,
        customerName: undefined,
      });
      await reply(phoneNumber, messages.askDescription(service));
      return;
    }

    case S.COLLECT_DESCRIPTION: {
      if (!text) {
        await reply(phoneNumber, messages.askDescription((ctx.service as any) ?? "TUGAS"));
        return;
      }
      const profile = getServiceProfile(ctx.service ?? "TUGAS");

      // Konsultasi gratis: langsung minta nama lalu serahkan ke admin.
      if (profile.tier === "FREE") {
        await setState(phoneNumber, S.COLLECT_NAME, { description: text });
        await reply(phoneNumber, messages.askName());
        return;
      }

      // Layanan dengan brief lengkap (coding/website/mobile app/dll): tanya detail satu per satu.
      if (profile.questions.length > 0) {
        await setState(phoneNumber, S.COLLECT_DETAILS, { description: text, details: [], detailIndex: 0 });
        await reply(
          phoneNumber,
          messages.askDetail({ index: 0, total: profile.questions.length, prompt: profile.questions[0].prompt })
        );
        return;
      }

      await setState(phoneNumber, S.COLLECT_DEADLINE, { description: text });
      await reply(phoneNumber, messages.askDeadline());
      return;
    }

    case S.COLLECT_DETAILS: {
      const profile = getServiceProfile(ctx.service ?? "TUGAS");
      const index = ctx.detailIndex ?? 0;
      const question = profile.questions[index];

      if (!question) {
        await setState(phoneNumber, S.COLLECT_DEADLINE);
        await reply(phoneNumber, messages.askDeadline());
        return;
      }
      if (!text) {
        await reply(phoneNumber, messages.askDetail({ index, total: profile.questions.length, prompt: question.prompt }));
        return;
      }

      const details = [...(ctx.details ?? [])];
      if (!(question.optional && isSkip(text))) {
        details.push({ label: question.label, value: text });
      }

      const nextIndex = index + 1;
      if (nextIndex < profile.questions.length) {
        await setState(phoneNumber, S.COLLECT_DETAILS, { details, detailIndex: nextIndex });
        await reply(
          phoneNumber,
          messages.askDetail({
            index: nextIndex,
            total: profile.questions.length,
            prompt: profile.questions[nextIndex].prompt,
          })
        );
        return;
      }

      await setState(phoneNumber, S.COLLECT_DEADLINE, { details, detailIndex: nextIndex });
      await reply(phoneNumber, messages.askDeadline());
      return;
    }

    case S.COLLECT_DEADLINE: {
      if (!text) {
        await reply(phoneNumber, messages.askDeadline());
        return;
      }
      const profile = getServiceProfile(ctx.service ?? "TUGAS");
      await setState(phoneNumber, S.COLLECT_REFERENCE, { deadline: text });
      await reply(phoneNumber, messages.askReference(profile.tier));
      return;
    }

    case S.COLLECT_REFERENCE: {
      // Referensi non-teks (foto/dokumen) TIDAK diterima lewat chat, melainkan
      // lewat link upload yang dikirim setelah order tercatat.
      if (media && !text) {
        await reply(phoneNumber, messages.referenceFileViaChatNote());
        return;
      }
      const reference = isSkip(text) ? undefined : text || undefined;
      await setState(phoneNumber, S.COLLECT_NAME, { reference });
      await reply(phoneNumber, messages.askName());
      return;
    }

    case S.COLLECT_NAME: {
      if (!text) {
        await reply(phoneNumber, messages.askName());
        return;
      }

      const customerName = text;
      const profile = getServiceProfile(ctx.service ?? "TUGAS");
      const order = await createOrder({
        phoneNumber,
        customerName,
        service: ctx.service ?? "TUGAS",
        description: ctx.description ?? "-",
        deadline: ctx.deadline ?? "-",
        reference: ctx.reference,
        details: ctx.details,
      });

      if (profile.tier === "FREE") {
        await setState(phoneNumber, S.PROCESSING, {}, order.id);
        await reply(phoneNumber, messages.konsultasiCreated(order.orderNumber));
        await maybeSendSticker(phoneNumber, env.stickers.orderCreated);
        await notifyAdminOfConsultation(customerName, phoneNumber, ctx.description ?? "-");
        return;
      }

      await setState(phoneNumber, S.WAITING_ADMIN_QUOTE, {}, order.id);
      await reply(
        phoneNumber,
        messages.orderCreated({ orderNumber: order.orderNumber, tier: profile.tier, uploadUrl: buildUploadUrl(order.id) })
      );
      await maybeSendSticker(phoneNumber, env.stickers.orderCreated);
      if (profile.tier === "HEAVY") {
        await notifyAdminOfHeavyOrder(order.orderNumber, order.service, customerName, phoneNumber);
      }
      return;
    }

    case S.WAITING_ADMIN_QUOTE: {
      await reply(phoneNumber, messages.adminWillContact());
      return;
    }

    case S.QUOTATION_SENT: {
      const choice = parseQuotationChoice(text);
      if (choice === "PAY") {
        if (!conversation.orderId) {
          await reply(phoneNumber, messages.noActiveOrder());
          return;
        }
        await setState(phoneNumber, S.WAITING_PAYMENT, {});
        await sendPaymentInstructions(phoneNumber, conversation.orderId);
        return;
      }
      if (choice === "ASK_ADMIN") {
        await reply(phoneNumber, messages.askAdminQuestion());
        return;
      }
      await reply(phoneNumber, messages.quotationInvalidChoice());
      return;
    }

    case S.WAITING_PAYMENT: {
      if (!conversation.orderId) {
        await reply(phoneNumber, messages.noActiveOrder());
        return;
      }
      const choice = parseQuotationChoice(text);
      if (choice === "ASK_ADMIN") {
        await reply(phoneNumber, messages.askAdminQuestion());
        return;
      }
      if (choice === "PAY") {
        await sendPaymentInstructions(phoneNumber, conversation.orderId);
        return;
      }
      // "sudah bayar" / teks lain: bukti tetap harus diupload lewat link.
      await reply(phoneNumber, messages.askProofViaLink(buildUploadUrl(conversation.orderId)));
      return;
    }

    case S.PAYMENT_REVIEW: {
      const order = conversation.orderId
        ? await prisma.order.findUnique({ where: { id: conversation.orderId } })
        : null;
      // Apa pun pesan customer di tahap ini, jawabannya: sedang divalidasi admin.
      await reply(phoneNumber, order ? messages.waitingValidation(order.orderNumber) : messages.adminWillContact());
      return;
    }

    case S.PROCESSING: {
      await reply(phoneNumber, messages.adminWillContact());
      return;
    }

    case S.REVIEW: {
      const parsed = parseRating(text);
      if (!parsed) {
        await reply(phoneNumber, messages.reviewInvalid());
        return;
      }
      if (conversation.orderId) {
        await prisma.review.upsert({
          where: { orderId: conversation.orderId },
          update: { rating: parsed.rating, feedback: parsed.feedback },
          create: { orderId: conversation.orderId, rating: parsed.rating, feedback: parsed.feedback },
        });
      }
      await setState(phoneNumber, S.COMPLETED, {});
      await reply(phoneNumber, messages.reviewThanks());
      return;
    }

    case S.COMPLETED:
    default: {
      await reply(phoneNumber, messages.fallbackUnknown());
      return;
    }
  }
}
