// Shared enums (as const string unions) used across the bot engine, services
// and API. Kept centralized so both must stay in sync.

export const SERVICES = {
  TUGAS: { label: "Tugas", emoji: "📚" },
  PPT: { label: "PPT", emoji: "🎨" },
  CV: { label: "CV", emoji: "📄" },
  CODING: { label: "Coding", emoji: "💻" },
  WEBSITE: { label: "Website", emoji: "🌐" },
  MOBILE_APP: { label: "Mobile App", emoji: "📱" },
  KONSULTASI: { label: "Konsultasi", emoji: "💬" },
} as const;

export type ServiceCode = keyof typeof SERVICES;

export const SERVICE_ORDER: ServiceCode[] = [
  "TUGAS",
  "PPT",
  "CV",
  "CODING",
  "WEBSITE",
  "MOBILE_APP",
  "KONSULTASI",
];

export const ORDER_STATUS = {
  WAITING_BRIEF: "WAITING_BRIEF",
  WAITING_QUOTATION: "WAITING_QUOTATION",
  WAITING_PAYMENT: "WAITING_PAYMENT",
  PAYMENT_REVIEW: "PAYMENT_REVIEW",
  PAID: "PAID",
  PROCESSING: "PROCESSING",
  REVIEW: "REVIEW",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

export type OrderStatus = keyof typeof ORDER_STATUS;

export const PAYMENT_STATUS = {
  PENDING: "PENDING",
  REVIEW: "REVIEW",
  PAID: "PAID",
  REJECTED: "REJECTED",
} as const;

export type PaymentStatusType = keyof typeof PAYMENT_STATUS;

// Bot conversation states (state machine)
export const CONVERSATION_STATE = {
  WELCOME: "WELCOME",
  SELECT_SERVICE: "SELECT_SERVICE",
  COLLECT_DESCRIPTION: "COLLECT_DESCRIPTION",
  COLLECT_DEADLINE: "COLLECT_DEADLINE",
  COLLECT_REFERENCE: "COLLECT_REFERENCE",
  COLLECT_NAME: "COLLECT_NAME",
  WAITING_ADMIN_QUOTE: "WAITING_ADMIN_QUOTE",
  QUOTATION_SENT: "QUOTATION_SENT",
  WAITING_PAYMENT: "WAITING_PAYMENT",
  PAYMENT_REVIEW: "PAYMENT_REVIEW",
  PROCESSING: "PROCESSING",
  REVIEW: "REVIEW",
  COMPLETED: "COMPLETED",
} as const;

export type ConversationStateType = keyof typeof CONVERSATION_STATE;

export const FILE_TYPE = {
  BRIEF: "BRIEF",
  REFERENCE: "REFERENCE",
  PROOF: "PROOF",
  RESULT: "RESULT",
  QRIS: "QRIS",
} as const;
