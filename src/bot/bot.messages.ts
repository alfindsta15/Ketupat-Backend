import { SERVICES, SERVICE_ORDER, ServiceCode } from "../utils/constants";

function serviceMenuLines(): string {
  return SERVICE_ORDER.map(
    (code, i) => `${i + 1}️⃣ ${SERVICES[code].emoji} ${SERVICES[code].label}`
  ).join("\n");
}

export const messages = {
  welcome: () =>
    `👋 Halo! Selamat datang di *KETUPAT*.\n\n` +
    `KERJAKAN TUGAS CEPAT & TEPAT 🚀\n\n` +
    `Mau bantu apa hari ini?\n\n${serviceMenuLines()}`,

  invalidServiceChoice: () =>
    `Maaf, aku belum memahami pilihan itu 😅\n\n` +
    `Silakan pilih:\n\n${serviceMenuLines()}`,

  askDescription: (serviceCode: ServiceCode) =>
    `Siap! Kita bantu untuk *${SERVICES[serviceCode].label}*.\n\n` +
    `Boleh jelaskan kebutuhan/tugas kamu secara detail? 📝`,

  askDeadline: () => `⏰ Kapan deadline pengerjaannya? (contoh: 30 September 2026)`,

  askReference: () =>
    `📎 Ada file pendukung atau referensi/contoh?\n\n` +
    `Kalau ada, kirim di sini (foto/dokumen) atau ceritakan singkat.\n` +
    `Kalau tidak ada, ketik *SKIP* ya.`,

  askName: () => `👤 Terakhir, boleh tau nama kamu?`,

  orderCreated: (orderNumber: string) =>
    `✅ Data pesanan kamu sudah diterima.\n\n` +
    `Order ID: #${orderNumber}\n\n` +
    `Tim KETUPAT akan memeriksa detail tugas dan menentukan harga.\n\n` +
    `Mohon tunggu sebentar ya 🙌`,

  /** Sent instead of orderCreated() when the chosen service is the free "Konsultasi". */
  konsultasiCreated: (orderNumber: string) =>
    `✅ Sip, pertanyaan kamu udah tercatat!\n\n` +
    `Order ID: #${orderNumber}\n\n` +
    `Konsultasi ini *FREE* alias gratis 🙌 Admin KETUPAT bakal langsung gas chat kamu di sini buat bahas lebih lanjut, jadi bukan bot lagi yang balas ya. Tunggu bentar!`,

  quotation: (opts: {
    orderNumber: string;
    serviceLabel: string;
    price: number;
    deadline: string;
  }) =>
    `💰 *QUOTATION KETUPAT*\n\n` +
    `Order: #${opts.orderNumber}\n` +
    `Layanan: ${opts.serviceLabel}\n` +
    `Harga: ${formatRupiah(opts.price)}\n` +
    `Deadline: ${opts.deadline}\n\n` +
    `Jika detail sudah sesuai, silakan lanjut ke pembayaran.\n\n` +
    `Ketik:\n1️⃣ LANJUT BAYAR\n2️⃣ TANYA ADMIN`,

  quotationInvalidChoice: () => `Ketik *1* buat LANJUT BAYAR atau *2* kalau masih mau TANYA ADMIN ya 🙏`,

  askAdminQuestion: () =>
    `💬 Sip, tulis aja pertanyaan/kendalanya. Admin KETUPAT bakal segera gas balas kok 🙌`,

  /**
   * `qrisUrl`, when provided, is appended as a clickable link the customer
   * taps to view/scan the QRIS - rather than the QRIS being pushed as a
   * WhatsApp image attachment (that path needs Fonnte's paid attachment
   * feature and doesn't always render reliably). See settings.service.ts.
   */
  payment: (opts: { orderNumber: string; total: number; qrisUrl?: string | null }) =>
    `💳 *PEMBAYARAN*\n\n` +
    `Order: #${opts.orderNumber}\n` +
    `Total: ${formatRupiah(opts.total)}\n\n` +
    (opts.qrisUrl
      ? `Klik/scan link QRIS ini buat bayar ya 👇\n🔗 ${opts.qrisUrl}\n\n`
      : `Silakan scan QRIS di bawah ini.\n\n`) +
    `Setelah bayar, langsung kirim *foto/screenshot* bukti pembayarannya di chat ini ya 📸\n\n` +
    `⚠️ Pastikan nominalnya sesuai invoice di atas.`,

  paymentNoQris: () =>
    `⚠️ Waduh, link QRIS belum ke-setting nih. Admin bakal segera hubungi kamu buat atur metode bayar lain ya 🙏`,

  proofReceived: () =>
    `✅ Bukti pembayaran sudah diterima.\n\n` +
    `Tim KETUPAT akan melakukan verifikasi.\n\n` +
    `Mohon tunggu.`,

  askProofAgain: () =>
    `Duh, itu teks ya 😅 Kirim *foto/screenshot* bukti transfer kamu dong, biar langsung kita cek!`,

  paymentVerified: (opts: { orderNumber: string; amount: number }) =>
    `🎉 *PEMBAYARAN BERHASIL*\n\n` +
    `Order: #${opts.orderNumber}\n\n` +
    `Pembayaran sebesar ${formatRupiah(opts.amount)} telah dikonfirmasi.\n\n` +
    `Pesanan kamu sekarang masuk ke tahap pengerjaan.\n\n` +
    statusProgress("PROCESSING") +
    `\n\nTerima kasih sudah menggunakan KETUPAT! 🚀`,

  statusReport: (opts: { orderNumber: string; status: string; statusLabel: string }) =>
    `📦 *STATUS ORDER*\n\n` +
    `Order: #${opts.orderNumber}\n\n` +
    statusProgress(opts.status) +
    `\n\nStatus saat ini:\n${opts.statusLabel}`,

  askOrderIdForStatus: () =>
    `📦 Masukkan Order ID kamu untuk cek status (contoh: KTP-00001):`,

  orderNotFound: () => `Maaf, Order ID tersebut tidak ditemukan 😅 Coba cek kembali ya.`,

  noActiveOrder: () =>
    `Kamu belum memiliki order aktif. Ketik *HALO* untuk mulai memesan ya 🙌`,

  completed: (opts: { orderNumber: string; resultUrl?: string | null }) =>
    `🎉 *PESANAN SELESAI!*\n\n` +
    `Order #${opts.orderNumber} sudah selesai dikerjakan.\n\n` +
    (opts.resultUrl ? `File hasil:\n${opts.resultUrl}\n\n` : "") +
    `Terima kasih sudah menggunakan KETUPAT ❤️\n\n` +
    `KERJAKAN TUGAS CEPAT & TEPAT.`,

  askReview: () =>
    `⭐ Bagaimana pengalaman kamu menggunakan KETUPAT?\n\n` +
    `Berikan rating 1–5:\n\n` +
    `1 ⭐\n2 ⭐⭐\n3 ⭐⭐⭐\n4 ⭐⭐⭐⭐\n5 ⭐⭐⭐⭐⭐\n\n` +
    `Kamu juga bisa menuliskan feedback.`,

  reviewInvalid: () => `Mohon berikan angka rating 1-5 ya 🙏`,

  reviewThanks: () => `Terima kasih atas feedback-nya! 🙏 Sampai jumpa di order berikutnya, KETUPAT selalu siap bantu 🚀`,

  fallbackUnknown: () =>
    `Hmm, aku belum nangkep maksud kamu nih 😅\n\n` +
    `Ketik *HALO* buat mulai order baru, atau *STATUS* buat cek order kamu ya.`,

  adminWillContact: () =>
    `🙌 Noted! Tim admin KETUPAT bakal segera gas hubungi kamu buat bahas lebih lanjut ya.`,
};

export function formatRupiah(value: number): string {
  return "Rp" + Math.round(value).toLocaleString("id-ID");
}

// Icon sequence per status, in the fixed order: [Brief, Pembayaran, Pengerjaan, Review, Selesai]
const PROGRESS_TABLE: Record<string, string[]> = {
  WAITING_BRIEF: ["⏳", "⏳", "⏳", "⏳", "⏳"],
  WAITING_QUOTATION: ["✅", "⏳", "⏳", "⏳", "⏳"],
  WAITING_PAYMENT: ["✅", "🔵", "⏳", "⏳", "⏳"],
  PAYMENT_REVIEW: ["✅", "🔵", "⏳", "⏳", "⏳"],
  PAID: ["✅", "✅", "🔵", "⏳", "⏳"],
  PROCESSING: ["✅", "✅", "🔵", "⏳", "⏳"],
  REVIEW: ["✅", "✅", "✅", "🔵", "⏳"],
  COMPLETED: ["✅", "✅", "✅", "✅", "✅"],
  CANCELLED: ["❌", "❌", "❌", "❌", "❌"],
};

export function statusProgress(status: string): string {
  const labels = ["Brief      ", "Pembayaran ", "Pengerjaan ", "Review     ", "Selesai    "];
  const icons = PROGRESS_TABLE[status] ?? PROGRESS_TABLE.WAITING_BRIEF;
  return labels.map((label, i) => `${label} ${icons[i]}`).join("\n");
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    WAITING_BRIEF: "📝 MENUNGGU DATA PESANAN",
    WAITING_QUOTATION: "🧾 MENUNGGU PENAWARAN HARGA",
    WAITING_PAYMENT: "💳 MENUNGGU PEMBAYARAN",
    PAYMENT_REVIEW: "🔎 PEMBAYARAN SEDANG DIVERIFIKASI",
    PAID: "✅ PEMBAYARAN TERKONFIRMASI",
    PROCESSING: "🔵 SEDANG DIKERJAKAN",
    REVIEW: "🔍 TAHAP REVIEW",
    COMPLETED: "🎉 SELESAI",
    CANCELLED: "❌ DIBATALKAN",
  };
  return map[status] ?? status;
}
