import { ServiceCode, SERVICE_ORDER, SERVICES } from "../utils/constants";

const SERVICE_ALIASES: Record<string, ServiceCode> = {
  "1": "TUGAS",
  tugas: "TUGAS",
  "joki": "TUGAS",
  "joki tugas": "TUGAS",
  "2": "PPT",
  ppt: "PPT",
  presentasi: "PPT",
  "3": "CV",
  cv: "CV",
  resume: "CV",
  "4": "CODING",
  coding: "CODING",
  code: "CODING",
  program: "CODING",
  programming: "CODING",
  "5": "WEBSITE",
  website: "WEBSITE",
  web: "WEBSITE",
  situs: "WEBSITE",
  "6": "MOBILE_APP",
  "mobile app": "MOBILE_APP",
  mobileapp: "MOBILE_APP",
  aplikasi: "MOBILE_APP",
  app: "MOBILE_APP",
  "7": "KONSULTASI",
  konsultasi: "KONSULTASI",
  konsul: "KONSULTASI",
  consult: "KONSULTASI",
};

/** Accepts a number ("1".."7") or a service name/alias, case-insensitive. */
export function parseServiceChoice(rawText: string): ServiceCode | null {
  const text = rawText.trim().toLowerCase().replace(/[️⃣]/g, "");
  if (SERVICE_ALIASES[text]) return SERVICE_ALIASES[text];

  // also try matching the emoji/number prefix like "1." or "1)"
  const numMatch = text.match(/^(\d)/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (idx >= 0 && idx < SERVICE_ORDER.length) return SERVICE_ORDER[idx];
  }

  return null;
}

export function serviceLabel(code: string): string {
  return (SERVICES as Record<string, { label: string }>)[code]?.label ?? code;
}

export type QuotationChoice = "PAY" | "ASK_ADMIN" | null;

export function parseQuotationChoice(rawText: string): QuotationChoice {
  const text = rawText.trim().toLowerCase();
  if (["1", "lanjut bayar", "bayar", "lanjut", "ya", "iya"].includes(text)) return "PAY";
  if (["2", "tanya admin", "tanya", "admin"].includes(text)) return "ASK_ADMIN";
  return null;
}

export type GlobalCommand = "GREETING" | "RESTART" | "STATUS" | null;

const GREETING_WORDS = [
  "halo", "hallo", "hai", "hi", "hei", "hey", "p", "pagi", "siang", "sore", "malam",
  "halo kak", "hallo kak", "hai kak", "hi kak", "halo min", "hai min", "permisi",
  "selamat pagi", "selamat siang", "selamat sore", "selamat malam",
  "assalamualaikum", "assalamu'alaikum", "assalamualaikum kak", "assalamualaikum min",
];
const RESTART_WORDS = ["mulai", "menu", "start", "order baru", "pesan baru", "order lagi"];

/**
 * GREETING : sapaan biasa. Bila customer punya order berjalan, sapaan TIDAK
 *            menghapus order tersebut (sebelumnya "halo" memutus order aktif
 *            sehingga bukti bayar sesudahnya tidak terbaca).
 * RESTART  : perintah eksplisit "menu"/"mulai" -> mulai order baru.
 */
export function parseGlobalCommand(rawText: string): GlobalCommand {
  const text = rawText.trim().toLowerCase().replace(/[!.?,]+$/g, "");
  if (RESTART_WORDS.includes(text)) return "RESTART";
  if (GREETING_WORDS.includes(text)) return "GREETING";
  // "STATUS", "CEK ORDER", optionally followed by an order id, e.g. "status KTP-00001"
  if (/^(status|cek order|cek status|order status)(\s|$)/.test(text)) return "STATUS";
  return null;
}

/** Customer menyatakan sudah membayar lewat teks ("sudah bayar", "udah transfer", "lunas"). */
export function isPaymentClaim(rawText: string): boolean {
  const text = rawText.trim().toLowerCase();
  if (!text) return false;
  return /(sudah|udah|dah|telah|sdh)\s*(bayar|transfer|tf|dibayar|ditransfer|lunas)|^lunas$|bukti\s*(bayar|transfer|pembayaran)|sudah\s*ya$/.test(text);
}

/** Parses a rating message like "5" or "5 mantap banget!" into { rating, feedback } */
export function parseRating(rawText: string): { rating: number; feedback?: string } | null {
  const text = rawText.trim();
  const match = text.match(/^([1-5])\b(.*)$/s);
  if (!match) return null;
  const rating = parseInt(match[1], 10);
  const feedback = match[2]?.trim();
  return { rating, feedback: feedback ? feedback : undefined };
}

export function isSkip(rawText: string): boolean {
  return ["skip", "tidak ada", "tidak", "-", "gak ada", "ga ada"].includes(rawText.trim().toLowerCase());
}
