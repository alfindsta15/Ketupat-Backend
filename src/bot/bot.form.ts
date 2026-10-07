import { SERVICES, ServiceCode } from "../utils/constants";
import { getServiceProfile } from "./bot.services";
import { isValidDeadline, isValidDescription, isValidDetail, isValidName, isValidReference } from "./bot.handlers";

/**
 * FORM SATU PESAN: semua pertanyaan pesanan dikirim sekaligus sebagai daftar bernomor, customer cukup
 * membalas 1 pesan. Bot membaca jawaban per nomor (atau urut baris), lalu hanya menanyakan ulang
 * bagian yang kurang/tidak valid dalam 1 pesan juga.
 */

export type FieldKind = "description" | "detail" | "deadline" | "reference" | "name";

export interface FormField {
  key: string; // description | d0, d1, ... | deadline | reference | name
  kind: FieldKind;
  label: string;
  optional: boolean;
}

const DESCRIPTION_LABEL: Record<string, string> = {
  TUGAS: "Topik/judul & yang diminta (boleh copy soalnya)",
  PPT: "Topik & tujuan presentasi",
  CV: "Latar belakang singkat (pendidikan, pengalaman, skill)",
  CODING: "Gambaran masalah/program yang dibutuhkan",
  WEBSITE: "Gambaran website (untuk apa & siapa penggunanya)",
  MOBILE_APP: "Gambaran aplikasi (untuk apa & siapa penggunanya)",
  KONSULTASI: "Pertanyaan/kendala kamu",
};

export function buildFormFields(service: string): FormField[] {
  const profile = getServiceProfile(service);
  const fields: FormField[] = [
    { key: "description", kind: "description", label: DESCRIPTION_LABEL[service] ?? "Kebutuhan kamu", optional: false },
  ];
  if (profile.tier !== "FREE") {
    profile.questions.forEach((q, i) =>
      fields.push({ key: `d${i}`, kind: "detail", label: q.label, optional: Boolean(q.optional) })
    );
    fields.push({ key: "deadline", kind: "deadline", label: "Deadline (mis. 30 September 2026 / besok sore)", optional: false });
    fields.push({ key: "reference", kind: "reference", label: "Link/keterangan referensi", optional: true });
  }
  fields.push({ key: "name", kind: "name", label: "Nama kamu", optional: false });
  return fields;
}

/** Pesan form: semua pertanyaan dalam satu daftar bernomor. */
export function formText(service: string): string {
  const profile = getServiceProfile(service);
  const meta = SERVICES[service as ServiceCode];
  const fields = buildFormFields(service);
  const greeting = profile.intro.split("\n\n")[0];
  const lines = fields.map((f, i) => `${i + 1}. ${f.label}${f.optional ? " (opsional)" : ""}:`).join("\n");
  return (
    `${greeting}\n\n` +
    `📝 *FORM PESANAN${meta ? ` - ${meta.label.toUpperCase()}` : ""}*\n` +
    `Copy form di bawah, isi, lalu kirim *dalam 1 pesan* ya (tidak perlu dijawab satu-satu) 👇\n\n` +
    `${lines}\n\n` +
    `💡 Yang bertanda (opsional) boleh dikosongkan. Jawaban boleh lebih dari 1 baris.`
  );
}

const MARKER = /^\s*(\d{1,2})\s*[.)\-:]\s*(.*)$/;
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** Buang label yang ikut tersalin ("Jumlah slide: 15" -> "15"). */
function stripLabel(answer: string, label: string): string {
  const colon = answer.indexOf(":");
  if (colon > 0 && colon <= label.length + 12) {
    const prefix = normalize(answer.slice(0, colon));
    const words = normalize(label).split(" ").filter(Boolean);
    const prefixWords = prefix.split(" ").filter(Boolean);
    if (prefixWords.length > 0 && prefixWords.every((w) => words.includes(w))) {
      return answer.slice(colon + 1).trim();
    }
  }
  return answer.trim();
}

/**
 * Baca balasan customer -> jawaban per indeks field.
 * 1) Format bernomor ("1. ...", "2) ..."), baris tanpa nomor = lanjutan jawaban sebelumnya.
 * 2) Tanpa nomor: bila jumlah baris = jumlah field yang diminta, dipetakan urut; bila hanya 1 field diminta, seluruh teks = jawabannya.
 */
export function parseFormReply(text: string, fields: FormField[], pending: number[]): Map<number, string> {
  const result = new Map<number, string>();
  const chunks = new Map<number, string[]>();
  let current: number | null = null;

  for (const line of text.split(/\r?\n/)) {
    const m = MARKER.exec(line);
    const n = m ? Number(m[1]) : 0;
    // Nomor harus naik terus: daftar bernomor di dalam sebuah jawaban ("1. login 2. cart") dianggap lanjutan jawaban.
    if (m && n >= 1 && n <= fields.length && (current === null || n - 1 > current)) {
      current = n - 1;
      chunks.set(current, [m[2]]);
    } else if (current !== null) {
      chunks.get(current)!.push(line);
    }
  }

  if (chunks.size > 0) {
    for (const [idx, parts] of chunks) {
      const joined = parts.join("\n").trim();
      result.set(idx, stripLabel(joined, fields[idx].label));
    }
    return result;
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (pending.length === 1) {
    result.set(pending[0], stripLabel(text.trim(), fields[pending[0]].label));
  } else if (lines.length === pending.length && pending.length > 1) {
    pending.forEach((idx, i) => result.set(idx, stripLabel(lines[i], fields[idx].label)));
  }
  return result;
}

const SKIP_WORDS = new Set(["", "-", "--", "skip", "tidak ada", "ga ada", "gak ada", "nggak ada", "belum", "kosong", "n/a"]);
export const isSkipAnswer = (raw: string) => SKIP_WORDS.has(raw.trim().toLowerCase());

export type FieldCheck = { status: "ok" } | { status: "skip" } | { status: "invalid"; reason: string };

export function checkField(field: FormField, raw: string): FieldCheck {
  const v = raw.trim();
  if (isSkipAnswer(v)) {
    return field.optional ? { status: "skip" } : { status: "invalid", reason: "belum diisi" };
  }
  switch (field.kind) {
    case "description":
      return isValidDescription(v) ? { status: "ok" } : { status: "invalid", reason: "tulis lebih lengkap (min. 10 karakter)" };
    case "detail":
      return isValidDetail(v) ? { status: "ok" } : { status: "invalid", reason: "jawabannya terlalu singkat/panjang" };
    case "deadline":
      return isValidDeadline(v) ? { status: "ok" } : { status: "invalid", reason: "tulis tanggal/durasi, mis. 30 September atau besok sore" };
    case "reference":
      return isValidReference(v) ? { status: "ok" } : { status: "invalid", reason: "maks. 500 karakter" };
    case "name":
      return isValidName(v) ? { status: "ok" } : { status: "invalid", reason: "cukup nama (2-50 huruf)" };
  }
}

/** Pesan tindak lanjut: hanya bagian yang kurang / belum valid, dalam 1 pesan. */
export function formProblemsText(fields: FormField[], problems: { index: number; reason: string }[]): string {
  const first = problems[0];
  const lines = problems.map((p) => `${p.index + 1}. ${fields[p.index].label}: _${p.reason}_`).join("\n");
  const example = fields[first.index].kind === "deadline" ? "besok sore" : "jawabanmu";
  return (
    `Hampir selesai! 🙌 Tinggal lengkapi bagian ini ya:\n\n${lines}\n\n` +
    `Cukup balas bagian ini saja dalam 1 pesan (tidak perlu kirim ulang semuanya), contoh:\n${first.index + 1}. ${example}`
  );
}
