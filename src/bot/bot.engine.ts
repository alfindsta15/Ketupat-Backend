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
  isValidDescription,
  isValidDetail,
  isValidDeadline,
  isValidName,
  isValidReference,
} from "./bot.handlers";
import { createOrder } from "../services/order.service";
import { ensurePendingPayment } from "../services/payment.service";
import { getActiveQris, hasDynamicQris } from "../services/settings.service";
import { fonnteService } from "../services/fonnte.service";
import { adminOrderUrl, notifyAdmins } from "../services/admin-notify.service";
import { buildFormFields, checkField, formProblemsText, formText, parseFormReply } from "./bot.form";
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

/** Kabari para admin (grup WhatsApp) bahwa ada orderan baru. */
async function notifyAdminsOfNewOrder(opts: {
  orderId: number;
  orderNumber: string;
  service: string;
  customerName: string;
  phoneNumber: string;
  description: string;
  deadline: string;
  details: { label: string; value: string }[];
  reference?: string;
}) {
  const adminUrl = adminOrderUrl(opts.orderId);
  const text =
    opts.service === "KONSULTASI"
      ? messages.adminConsultation({
          customerName: opts.customerName,
          phoneNumber: opts.phoneNumber,
          description: opts.description,
          adminUrl,
        })
      : messages.adminNewOrder({
          orderNumber: opts.orderNumber,
          serviceLabel: serviceLabel(opts.service),
          customerName: opts.customerName,
          phoneNumber: opts.phoneNumber,
          description: opts.description,
          deadline: opts.deadline,
          details: opts.details,
          reference: opts.reference,
          adminUrl,
        });
  await notifyAdmins(text);
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
      paymentKind: order.payments[0]?.kind ?? null,
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
  WAITING_FINAL_PAYMENT: [S.WAITING_PAYMENT],
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
  const payment = await ensurePendingPayment(order.id);
  const qris = await getActiveQris();
  const dynamicQris = await hasDynamicQris();
  await reply(
    phoneNumber,
    messages.payment({
      orderNumber: order.orderNumber,
      total: payment?.amount ?? order.price ?? 0,
      kind: payment?.kind,
      dynamicQris,
      qrisUrl: qris?.url,
      uploadUrl: buildUploadUrl(order.id),
    })
  );
  if (!qris && !dynamicQris) await reply(phoneNumber, messages.paymentNoQris());
}

/** Buat order dari jawaban yang sudah lengkap, balas customer, dan kabari admin (dipakai form satu pesan & alur lama). */
async function finalizeOrder(
  phoneNumber: string,
  data: {
    service: string;
    description: string;
    deadline: string;
    reference?: string;
    details?: { label: string; value: string }[];
    customerName: string;
  }
) {
  const profile = getServiceProfile(data.service);
  const order = await createOrder({
    phoneNumber,
    customerName: data.customerName,
    service: data.service,
    description: data.description,
    deadline: data.deadline,
    reference: data.reference,
    details: data.details,
  });

  if (profile.tier === "FREE") {
    await setState(phoneNumber, S.PROCESSING, {}, order.id);
    await reply(phoneNumber, messages.konsultasiCreated(order.orderNumber));
    await maybeSendSticker(phoneNumber, env.stickers.orderCreated);
    await notifyAdminsOfNewOrder({
      orderId: order.id,
      orderNumber: order.orderNumber,
      service: order.service,
      customerName: data.customerName,
      phoneNumber,
      description: data.description,
      deadline: "-",
      details: [],
    });
    return;
  }

  await setState(phoneNumber, S.WAITING_ADMIN_QUOTE, {}, order.id);
  await reply(
    phoneNumber,
    messages.orderCreated({ orderNumber: order.orderNumber, tier: profile.tier, uploadUrl: buildUploadUrl(order.id) })
  );
  await maybeSendSticker(phoneNumber, env.stickers.orderCreated);
  await notifyAdminsOfNewOrder({
    orderId: order.id,
    orderNumber: order.orderNumber,
    service: order.service,
    customerName: data.customerName,
    phoneNumber,
    description: data.description,
    deadline: data.deadline,
    details: data.details ?? [],
    reference: data.reference,
  });
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
      // Form satu pesan: semua pertanyaan dikirim sekaligus, customer menjawab dalam 1 pesan.
      await setState(phoneNumber, S.COLLECT_FORM, {
        service,
        formAnswers: {},
        description: undefined,
        details: [],
        detailIndex: 0,
        deadline: undefined,
        reference: undefined,
        customerName: undefined,
      });
      await reply(phoneNumber, formText(service));
      return;
    }

    case S.COLLECT_DESCRIPTION: {
      if (!text) {
        await reply(phoneNumber, messages.askDescription((ctx.service as any) ?? "TUGAS"));
        return;
      }
      if (!isValidDescription(text)) {
        await reply(phoneNumber, messages.invalidDescription());
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

      const skipped = Boolean(question.optional) && isSkip(text);
      if (!skipped && !isValidDetail(text)) {
        await reply(phoneNumber, messages.invalidDetail(question.prompt));
        return;
      }

      const details = [...(ctx.details ?? [])];
      if (!skipped) {
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
      if (!isValidDeadline(text)) {
        await reply(phoneNumber, messages.invalidDeadline());
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
      if (!isSkip(text) && !isValidReference(text)) {
        await reply(phoneNumber, messages.invalidReference());
        return;
      }
      const reference = isSkip(text) ? undefined : text || undefined;
      await setState(phoneNumber, S.COLLECT_NAME, { reference });
      await reply(phoneNumber, messages.askName());
      return;
    }

    case S.COLLECT_FORM: {
      const service = ctx.service ?? "TUGAS";
      if (!text) {
        await reply(phoneNumber, media ? messages.formNeedText() : formText(service));
        return;
      }
      const fields = buildFormFields(service);
      const answers: Record<string, string> = { ...(ctx.formAnswers ?? {}) };
      const pending = fields.map((_, i) => i).filter((i) => answers[fields[i].key] === undefined);
      const parsed = parseFormReply(text, fields, pending);

      const invalid = new Map<number, string>();
      for (const [idx, raw] of parsed) {
        const check = checkField(fields[idx], raw);
        if (check.status === "ok") answers[fields[idx].key] = raw.trim();
        else if (check.status === "skip") answers[fields[idx].key] = "";
        else invalid.set(idx, check.reason);
      }

      const problems: { index: number; reason: string }[] = [];
      fields.forEach((f, i) => {
        if (invalid.has(i)) problems.push({ index: i, reason: invalid.get(i)! });
        else if (!f.optional && answers[f.key] === undefined) problems.push({ index: i, reason: "belum diisi" });
      });

      if (problems.length > 0) {
        await setState(phoneNumber, S.COLLECT_FORM, { formAnswers: answers });
        // Tidak ada satu pun jawaban yang terbaca: kirim ulang form (bukan daftar kekurangan).
        if (parsed.size === 0 && Object.keys(answers).length === 0) {
          await reply(phoneNumber, formText(service));
        } else {
          await reply(phoneNumber, formProblemsText(fields, problems));
        }
        return;
      }

      const details = fields
        .filter((f) => f.kind === "detail" && answers[f.key])
        .map((f) => ({ label: f.label, value: answers[f.key] }));
      await finalizeOrder(phoneNumber, {
        service,
        description: answers.description,
        deadline: answers.deadline || "-",
        reference: answers.reference || undefined,
        details,
        customerName: answers.name,
      });
      return;
    }

    case S.COLLECT_NAME: {
      if (!text) {
        await reply(phoneNumber, messages.askName());
        return;
      }

      if (!isValidName(text)) {
        await reply(phoneNumber, messages.invalidName());
        return;
      }
      await finalizeOrder(phoneNumber, {
        service: ctx.service ?? "TUGAS",
        description: ctx.description ?? "-",
        deadline: ctx.deadline ?? "-",
        reference: ctx.reference,
        details: ctx.details,
        customerName: text.trim(),
      });
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
