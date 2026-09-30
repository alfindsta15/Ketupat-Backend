import { prisma } from "../lib/prisma";
import { CONVERSATION_STATE } from "../utils/constants";

export interface DraftOrderContext {
  service?: string;
  description?: string;
  deadline?: string;
  reference?: string;
  customerName?: string;
  pendingRating?: number;
  pendingStatusLookup?: boolean;
}

/** Ensures a User row exists for this phone number, and returns it. */
export async function ensureUser(phoneNumber: string) {
  return prisma.user.upsert({
    where: { phoneNumber },
    update: {},
    create: { phoneNumber },
  });
}

/** Gets (or lazily creates) the conversation/state-machine row for a phone number. */
export async function getOrCreateConversation(phoneNumber: string) {
  await ensureUser(phoneNumber);
  return prisma.conversation.upsert({
    where: { phoneNumber },
    update: {},
    create: { phoneNumber, state: CONVERSATION_STATE.WELCOME },
  });
}

export function readContext(conversation: { context: string | null }): DraftOrderContext {
  if (!conversation.context) return {};
  try {
    return JSON.parse(conversation.context) as DraftOrderContext;
  } catch {
    return {};
  }
}

export async function setState(
  phoneNumber: string,
  state: string,
  contextPatch?: Partial<DraftOrderContext>,
  orderId?: number | null
) {
  const current = await prisma.conversation.findUnique({ where: { phoneNumber } });
  const existingContext = current ? readContext(current) : {};
  const mergedContext = contextPatch ? { ...existingContext, ...contextPatch } : existingContext;

  return prisma.conversation.update({
    where: { phoneNumber },
    data: {
      state,
      context: JSON.stringify(mergedContext),
      ...(orderId !== undefined ? { orderId } : {}),
    },
  });
}

export async function clearContext(phoneNumber: string) {
  return prisma.conversation.update({
    where: { phoneNumber },
    data: { context: JSON.stringify({}) },
  });
}
