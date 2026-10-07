/**
 * QRIS dinamis tanpa payment gateway: dari kode QRIS STATIS milik merchant (teks hasil scan QRIS),
 * dibuat kode QRIS baru yang sudah memuat nominal (tag 54) lalu checksum CRC16 dihitung ulang.
 * Aplikasi pembayaran (GoPay/OVO/DANA/m-banking, dll.) otomatis mengisi nominalnya.
 * Catatan: ini hanya mengisi nominal; pembayaran tetap diverifikasi admin lewat bukti bayar.
 */

interface Tlv {
  id: string;
  value: string;
}

/** CRC16-CCITT (poly 0x1021, init 0xFFFF) -> 4 digit hex kapital. */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function parseTlv(payload: string): Tlv[] | null {
  const out: Tlv[] = [];
  let i = 0;
  while (i < payload.length) {
    if (i + 4 > payload.length) return null;
    const id = payload.slice(i, i + 2);
    const lenText = payload.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(lenText)) return null;
    const len = Number(lenText);
    const value = payload.slice(i + 4, i + 4 + len);
    if (value.length !== len) return null;
    out.push({ id, value });
    i += 4 + len;
  }
  return out;
}

const serialize = (tlvs: Tlv[]) => tlvs.map((t) => t.id + String(t.value.length).padStart(2, "0") + t.value).join("");

/** Bersihkan teks yang ditempel admin: buang baris baru/tab dan spasi di ujung. Spasi DI DALAM (mis. nama merchant) dipertahankan. */
export const cleanQrisPayload = (raw: string) => raw.replace(/[\r\n\t]+/g, "").trim();

/** Mengembalikan pesan error bila bukan kode QRIS yang valid, atau null bila valid. */
export function validateQrisPayload(raw: string): string | null {
  const payload = cleanQrisPayload(raw);
  if (!payload.startsWith("000201")) return "Bukan kode QRIS: harus diawali 000201. Salin teks hasil scan QRIS-mu utuh.";
  const tlvs = parseTlv(payload);
  if (!tlvs) return "Format kode QRIS tidak valid (terpotong?). Salin teks hasil scan secara utuh.";
  const last = tlvs[tlvs.length - 1];
  if (last.id !== "63" || last.value.length !== 4) return "Kode QRIS tidak memiliki checksum di akhir (tag 63).";
  const body = payload.slice(0, payload.length - 4);
  if (crc16(body) !== last.value.toUpperCase()) return "Checksum kode QRIS tidak cocok. Pastikan teks disalin utuh tanpa perubahan.";
  if (!tlvs.some((t) => t.id === "58")) return "Kode QRIS tidak memiliki kode negara (tag 58).";
  return null;
}

/** Nama merchant (tag 59) untuk ditampilkan di dashboard. */
export function qrisMerchantName(raw: string): string | null {
  const tlvs = parseTlv(cleanQrisPayload(raw));
  return tlvs?.find((t) => t.id === "59")?.value ?? null;
}

/** Buat QRIS dinamis dengan nominal tertentu (rupiah, bilangan bulat). */
export function makeDynamicQris(staticPayload: string, amount: number): string {
  const payload = cleanQrisPayload(staticPayload);
  const err = validateQrisPayload(payload);
  if (err) throw new Error(err);
  const value = Math.round(amount);
  if (!Number.isFinite(value) || value < 1 || value > 9999999999) throw new Error("Nominal QRIS tidak valid.");

  const tlvs = (parseTlv(payload) as Tlv[]).filter((t) => t.id !== "63" && t.id !== "54");
  for (const t of tlvs) if (t.id === "01") t.value = "12"; // 11 = statis, 12 = dinamis

  const amountTag: Tlv = { id: "54", value: String(value) };
  const at = tlvs.findIndex((t) => t.id > "54");
  if (at === -1) tlvs.push(amountTag);
  else tlvs.splice(at, 0, amountTag);

  const body = serialize(tlvs) + "6304";
  return body + crc16(body);
}
