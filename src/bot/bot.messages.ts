import { SERVICES, SERVICE_ORDER, ServiceCode } from "../utils/constants";

function serviceMenuLines(): string {
  return SERVICE_ORDER.map(
    (code, i) => `${i + 1}️⃣ ${SERVICES[code].emoji} ${SERVICES[code].label}`
  ).join("\n");
}

export function formatRupiah(value: number): string {
  return "Rp" + Math.round(value).toLocaleString("id-ID");
}

/** Menyapa dengan nama bila sudah diketahui, mis. "kak Budi". */
function callName(name?: string | null): string {
  const n = (name ?? "").trim();
  return n ? `kak ${n}` : "kak";
}

export type PaymentState = "NONE" | "PENDING" | "REVIEW" | "PAID" | "REJECTED";

export function paymentStatusLabel(status: PaymentState | string | null | undefined): string {
  switch (status) {
    case "PAID":
      return "✅ Sudah dibayar (lunas)";
    case "REVIEW":
      return "🔎 Bukti diterima, sedang diverifikasi";
    case "REJECTED":
      return "❌ Bukti belum sesuai, mohon kirim ulang";
    case "PENDING":
      return "⏳ Belum dibayar";
    default:
      return "➖ Belum ada tagihan";
  }
}

export const messages = {
  /** Pesan pembuka. Ramah, singkat, dan menjelaskan alur supaya customer tidak bingung. */
  welcome: (name?: string | null) =>
    `Halo ${callName(name)}! 👋😊\n` +
    `Selamat datang di *KETUPAT*\n` +
    `_Kerjakan Tugas Cepat & Tepat_ 🚀\n\n` +
    `Aku asisten yang siap bantu kamu 24 jam. Caranya gampang kok:\n` +
    `1️⃣ Pilih layanan\n` +
    `2️⃣ Ceritakan kebutuhanmu\n` +
    `3️⃣ Kami kirim penawaran harga\n` +
    `4️⃣ Bayar via QRIS, lalu kami langsung kerjakan ✨\n\n` +
    `Yuk, mau dibantu apa hari ini? Balas dengan *angka* atau nama layanannya ya 👇\n\n` +
    `${serviceMenuLines()}\n\n` +
    `💡 Ketik *STATUS* kapan saja untuk cek progres pesananmu.`,

  /** Dipakai saat customer menyapa padahal masih punya order berjalan. */
  greetingWithActiveOrder: (opts: { name?: string | null; orderNumber: string; statusLabel: string }) =>
    `Halo ${callName(opts.name)}! 👋😊 Senang ketemu lagi.\n\n` +
    `Pesanan kamu *#${opts.orderNumber}* saat ini:\n${opts.statusLabel}\n\n` +
    `Ketik *STATUS* untuk detail progres, atau *MENU* kalau mau bikin pesanan baru ya 🙌`,

  invalidServiceChoice: () =>
    `Maaf, aku belum paham pilihan itu 😅\n\n` +
    `Coba balas dengan *angka 1-7* atau nama layanannya ya:\n\n${serviceMenuLines()}`,

  askDescription: (serviceCode: ServiceCode) =>
    `Siap! Kita bantu untuk *${SERVICES[serviceCode].label}* ${SERVICES[serviceCode].emoji}\n\n` +
    `Boleh ceritakan kebutuhan/tugas kamu sedetail mungkin? 📝\n` +
    `Makin lengkap infonya, makin akurat harganya.`,

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

  konsultasiCreated: (orderNumber: string) =>
    `✅ Sip, pertanyaan kamu udah tercatat!\n\n` +
    `Order ID: #${orderNumber}\n\n` +
    `Konsultasi ini *FREE* alias gratis 🙌 Admin KETUPAT bakal langsung gas chat kamu di sini buat bahas lebih lanjut, jadi bukan bot lagi yang balas ya. Tunggu bentar!`,

  quotation: (opts: { orderNumber: string; serviceLabel: string; price: number; deadline: string }) =>
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

  proofReceived: (orderNumber?: string) =>
    `✅ Bukti pembayaran${orderNumber ? ` untuk order #${orderNumber}` : ""} sudah kami terima. Makasih ya! 🙏\n\n` +
    `Tim KETUPAT sedang memverifikasi. Begitu terkonfirmasi, kamu otomatis dapat kabar di sini.\n\n` +
    `Mohon tunggu sebentar ya ⏳`,

  /** Dipakai bila customer menulis "sudah bayar" tanpa foto yang terbaca. */
  paymentClaimReceived: (orderNumber?: string) =>
    `Oke, noted! 🙌 Kami catat kamu sudah bayar${orderNumber ? ` untuk order #${orderNumber}` : ""} dan admin akan cek langsung.\n\n` +
    `Biar lebih cepat diverifikasi, kirim juga *foto/screenshot* bukti transfernya ya 📸`,

  askProofAgain: () =>
    `Aku belum nerima fotonya nih 😅\n\n` +
    `Kirim *foto/screenshot* bukti transfer langsung di chat ini ya (bukan teks) 📸\n` +
    `Kalau sudah bayar tapi foto tidak terbaca, ketik *SUDAH BAYAR* dan admin akan cek manual.`,

  paymentVerified: (opts: { orderNumber: string; amount: number }) =>
    `🎉 *PEMBAYARAN BERHASIL*\n\n` +
    `Order: #${opts.orderNumber}\n\n` +
    `Pembayaran sebesar ${formatRupiah(opts.amount)} telah dikonfirmasi.\n\n` +
    `Pesanan kamu sekarang masuk ke tahap pengerjaan.\n\n` +
    statusProgress("PROCESSING") +
    `\n\nTerima kasih sudah menggunakan KETUPAT! 🚀`,

  paymentRejected: (orderNumber: string) =>
    `⚠️ *PEMBAYARAN BELUM SESUAI*\n\nOrder: #${orderNumber}\n\n` +
    `Bukti pembayaran yang kamu kirim belum bisa kami verifikasi. Mohon kirim ulang bukti pembayaran yang jelas dan sesuai nominal invoice ya 🙏`,

  /* ---------- Pesan otomatis saat admin mengubah status lewat web ---------- */

  statusWaitingQuotation: (orderNumber: string) =>
    `🧾 *UPDATE ORDER*\n\nOrder: #${orderNumber}\n\n` +
    `Pesanan kamu sedang kami cek untuk penentuan harga. Kami kabari begitu penawarannya siap ya 🙌`,

  statusPaymentReview: (orderNumber: string) =>
    `🔎 *UPDATE ORDER*\n\nOrder: #${orderNumber}\n\n` +
    `Pembayaran kamu sedang kami verifikasi. Mohon tunggu sebentar ya ⏳`,

  statusProcessing: (orderNumber: string) =>
    `🔵 *UPDATE ORDER*\n\nOrder: #${orderNumber}\n\n` +
    `Pesanan kamu sedang kami kerjakan sekarang. Kami kabari lagi begitu selesai ya 🚀\n\n` +
    statusProgress("PROCESSING"),

  statusCancelled: (orderNumber: string) =>
    `❌ *ORDER DIBATALKAN*\n\nOrder: #${orderNumber}\n\n` +
    `Pesanan ini sudah dibatalkan. Kalau ini di luar dugaan atau kamu mau pesan lagi, ketik *MENU* ya 🙏`,

  statusReport: (opts: {
    orderNumber: string;
    status: string;
    statusLabel: string;
    price?: number | null;
    paymentStatus?: string | null;
  }) =>
    `📦 *STATUS ORDER*\n\n` +
    `Order: #${opts.orderNumber}\n` +
    (opts.price ? `Harga: ${formatRupiah(opts.price)}\n` : "") +
    `Pembayaran: ${paymentStatusLabel(opts.paymentStatus)}\n\n` +
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

  reviewThanks: () =>
    `Terima kasih atas feedback-nya! 🙏 Sampai jumpa di order berikutnya, KETUPAT selalu siap bantu 🚀`,

  fallbackUnknown: () =>
    `Hmm, aku belum nangkep maksud kamu nih 😅\n\n` +
    `Ketik *MENU* buat mulai order baru, atau *STATUS* buat cek order kamu ya.`,

  adminWillContact: () =>
    `🙌 Noted! Tim admin KETUPAT bakal segera gas hubungi kamu buat bahas lebih lanjut ya.`,
};

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
