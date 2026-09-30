import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";
import { messages, statusLabel } from "./bot.messages";
import {
  ensureUser,
  getOrCreateConversation,
  readContext,
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
import { createOrder, findOrderByOrderNumber, findLatestOrderForPhone } from "../services/order.service";
import { submitPaymentProof } from "../services/payment.service";
import { getActiveQris } from "../services/settings.service";
import { fonnteService } from "../services/fonnte.service";
import { CONVERSATION_STATE, ORDER_STATUS } from "../utils/constants";
import { parseOrderNumber } from "../utils/orderNumber";
import { env } from "../config/env";
import { maybeSendSticker } from "../utils/sticker";

export interface IncomingWhatsAppMessage {
  phoneNumber: string; // already normalized
  text: string;
  messageType: "text" | "image" | "document" | "location" | "other";
  mediaLocalPath?: string | null; // our own downloaded copy, public relative path
  senderName?: string;
}

async function logMessage(phoneNumber: string, direction: "IN" | "OUT", message: string, messageType = "text") {
  try {
    await prisma.message.create({ data: { phoneNumber, direction, message, messageType } });
  } catch (err) {
    logger.error("Failed to persist message log", { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Sends a WhatsApp text reply and logs it. */
async function reply(phoneNumber: string, text: string) {
  await logMessage(phoneNumber, "OUT", text, "text");
  await fonnteService.sendText(phoneNumber, text);
}

/**
 * Pings the real human admin's own WhatsApp number (if configured) when a
 * customer requests the free "Konsultasi" service, so the admin can jump
 * into that chat personally instead of the bot. Intentionally NOT written
 * to the Message table (that table is keyed to customer conversations, and
 * the admin's own number normally has no matching User row).
 */
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

async function sendStatusForOrder(phoneNumber: string, orderId: number) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
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
    })
  );
}

/**
 * Main entry point: routes one incoming WhatsApp message through the bot's
 * state machine and produces the appropriate reply/replies.
 */
export async function handleIncomingMessage(input: IncomingWhatsAppMessage): Promise<void> {
  const { phoneNumber } = input;
  const text = (input.text ?? "").trim();

  // The message log has a foreign key to User, so the user row must exist
  // BEFORE the very first inbound message from a new customer is logged.
  await ensureUser(phoneNumber);
  await logMessage(phoneNumber, "IN", text || `[${input.messageType}]`, input.messageType);

  const conversation = await getOrCreateConversation(phoneNumber);
  const ctx = readContext(conversation);

  // ---- 1. Handle "awaiting order id for status" side-flow, if active ----
  if (ctx.pendingStatusLookup) {
    const orderId = parseOrderNumber(text);
    await setState(phoneNumber, conversation.state, { pendingStatusLookup: undefined });
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

  // ---- 2. Global commands work from (almost) any state ----
  const globalCommand = parseGlobalCommand(text);

  if (globalCommand === "RESTART") {
    await setState(phoneNumber, CONVERSATION_STATE.SELECT_SERVICE, {}, null);
    await reply(phoneNumber, messages.welcome());
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
    await setState(phoneNumber, conversation.state, { pendingStatusLookup: true });
    await reply(phoneNumber, messages.askOrderIdForStatus());
    return;
  }

  // ---- 3. Route based on current conversation state ----
  switch (conversation.state) {
    case CONVERSATION_STATE.WELCOME: {
      await setState(phoneNumber, CONVERSATION_STATE.SELECT_SERVICE, {});
      await reply(phoneNumber, messages.welcome());
      return;
    }

    case CONVERSATION_STATE.SELECT_SERVICE: {
      const service = parseServiceChoice(text);
      if (!service) {
        await reply(phoneNumber, messages.invalidServiceChoice());
        return;
      }
      await setState(phoneNumber, CONVERSATION_STATE.COLLECT_DESCRIPTION, { service });
      await reply(phoneNumber, messages.askDescription(service));
      return;
    }

    case CONVERSATION_STATE.COLLECT_DESCRIPTION: {
      if (!text) {
        await reply(phoneNumber, messages.askDescription((ctx.service as any) ?? "TUGAS"));
        return;
      }
      // "Konsultasi" is free and doesn't need a deadline/reference/quotation -
      // skip straight to the customer's name so a real admin can take over.
      if (ctx.service === "KONSULTASI") {
        await setState(phoneNumber, CONVERSATION_STATE.COLLECT_NAME, { description: text });
        await reply(phoneNumber, messages.askName());
        return;
      }
      await setState(phoneNumber, CONVERSATION_STATE.COLLECT_DEADLINE, { description: text });
      await reply(phoneNumber, messages.askDeadline());
      return;
    }

    case CONVERSATION_STATE.COLLECT_DEADLINE: {
      if (!text) {
        await reply(phoneNumber, messages.askDeadline());
        return;
      }
      await setState(phoneNumber, CONVERSATION_STATE.COLLECT_REFERENCE, { deadline: text });
      await reply(phoneNumber, messages.askReference());
      return;
    }

    case CONVERSATION_STATE.COLLECT_REFERENCE: {
      let reference: string | undefined;
      if (input.messageType === "image" || input.messageType === "document") {
        reference = input.mediaLocalPath ? `Lampiran: ${input.mediaLocalPath}` : "Lampiran diterima";
      } else if (!isSkip(text)) {
        reference = text || undefined;
      }
      await setState(phoneNumber, CONVERSATION_STATE.COLLECT_NAME, { reference });
      await reply(phoneNumber, messages.askName());
      return;
    }

    case CONVERSATION_STATE.COLLECT_NAME: {
      if (!text) {
        await reply(phoneNumber, messages.askName());
        return;
      }

      const finalCtx = { ...ctx, customerName: text };
      const order = await createOrder({
        phoneNumber,
        customerName: finalCtx.customerName!,
        service: finalCtx.service ?? "TUGAS",
        description: finalCtx.description ?? "-",
        deadline: finalCtx.deadline ?? "-",
        reference: finalCtx.reference,
      });

      if (order.service === "KONSULTASI") {
        // Free service: no quotation/payment step - hand off to a real admin.
        await setState(phoneNumber, CONVERSATION_STATE.PROCESSING, {}, order.id);
        await reply(phoneNumber, messages.konsultasiCreated(order.orderNumber));
        await maybeSendSticker(phoneNumber, env.stickers.orderCreated);
        await notifyAdminOfConsultation(finalCtx.customerName!, phoneNumber, finalCtx.description ?? "-");
        return;
      }

      await setState(phoneNumber, CONVERSATION_STATE.WAITING_ADMIN_QUOTE, {}, order.id);
      await reply(phoneNumber, messages.orderCreated(order.orderNumber));
      await maybeSendSticker(phoneNumber, env.stickers.orderCreated);
      return;
    }

    case CONVERSATION_STATE.WAITING_ADMIN_QUOTE: {
      // Nothing to parse here - admin is preparing a quotation from the dashboard.
      // Any message sent by the customer at this point is just logged (already
      // done above) so the admin can see it in the conversation history.
      await reply(phoneNumber, messages.adminWillContact());
      return;
    }

    case CONVERSATION_STATE.QUOTATION_SENT: {
      const choice = parseQuotationChoice(text);
      if (choice === "PAY") {
        const order = conversation.orderId
          ? await prisma.order.findUnique({ where: { id: conversation.orderId } })
          : null;
        if (!order) {
          await reply(phoneNumber, messages.noActiveOrder());
          return;
        }
        const qris = await getActiveQris();
        await setState(phoneNumber, CONVERSATION_STATE.WAITING_PAYMENT, {});

        // The QRIS is sent as a clickable link the customer taps to view/scan,
        // not as a WhatsApp image attachment (see bot.messages.ts `payment`).
        await reply(
          phoneNumber,
          messages.payment({ orderNumber: order.orderNumber, total: order.price ?? 0, qrisUrl: qris?.url })
        );
        if (!qris) {
          await reply(phoneNumber, messages.paymentNoQris());
        }
        return;
      }
      if (choice === "ASK_ADMIN") {
        await reply(phoneNumber, messages.askAdminQuestion());
        return;
      }
      await reply(phoneNumber, messages.quotationInvalidChoice());
      return;
    }

    case CONVERSATION_STATE.WAITING_PAYMENT: {
      if (input.messageType === "image" || input.messageType === "document") {
        if (!conversation.orderId) {
          await reply(phoneNumber, messages.noActiveOrder());
          return;
        }
        await submitPaymentProof(conversation.orderId, input.mediaLocalPath ?? "");
        await setState(phoneNumber, CONVERSATION_STATE.PAYMENT_REVIEW, {});
        await reply(phoneNumber, messages.proofReceived());
        return;
      }
      await reply(phoneNumber, messages.askProofAgain());
      return;
    }

    case CONVERSATION_STATE.PAYMENT_REVIEW: {
      // Waiting for an admin to click "Verifikasi Pembayaran" on the dashboard.
      // Incoming messages here are just logged for admin visibility.
      await reply(phoneNumber, messages.adminWillContact());
      return;
    }

    case CONVERSATION_STATE.PROCESSING: {
      await reply(phoneNumber, messages.adminWillContact());
      return;
    }

    case CONVERSATION_STATE.REVIEW: {
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
      await setState(phoneNumber, CONVERSATION_STATE.COMPLETED, {});
      await reply(phoneNumber, messages.reviewThanks());
      return;
    }

    case CONVERSATION_STATE.COMPLETED:
    default: {
      await reply(phoneNumber, messages.fallbackUnknown());
      return;
    }
  }
}