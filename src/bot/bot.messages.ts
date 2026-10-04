import { SERVICES, SERVICE_ORDER, ServiceCode } from "../utils/constants";
import { getServiceProfile, ServiceTier } from "./bot.services";

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

export function paymentStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "PAID":
      return "✅ Sudah dibayar (lunas)";
    case "REVIEW":
      return "🔎 Bukti diterima, menunggu validasi admin";
    case "REJECTED":
      return "❌ Bukti belum sesuai, mohon upload ulang";
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

  /** Respon berbeda per layanan (ringan / berat / gratis). */
  askDescription: (serviceCode: ServiceCode) => getServiceProfile(serviceCode).intro,

  /** Pertanyaan detail per layanan (khusus layanan dengan brief lebih lengkap). */
  askDetail: (opts: { index: number; total: number; prompt: string }) =>
    `*(${opts.index + 1}/${opts.total})* ${opts.prompt}`,

  askDeadline: () => `⏰ Kapan deadline pengerjaannya? (contoh: 30 September 2026)`,

  askReference: (tier: ServiceTier) =>
    tier === "HEAVY"
      ? `📎 Ada referensi tertulis? Misalnya link Figma/Drive/GitHub atau contoh yang kamu suka.\n\n` +
        `Tulis di sini, atau ketik *SKIP* kalau tidak ada. Untuk *file/foto/dokumen* (mockup, SRS, kode lama .zip), nanti aku kirim link upload khusus setelah pesanan tercatat ya 🙌`
      : `📎 Ada link referensi/contoh yang mau dijadikan acuan?\n\n` +
        `Tulis di sini, atau ketik *SKIP* kalau tidak ada. Untuk *file/foto/dokumen*, nanti aku kirim link upload khusus setelah pesanan tercatat ya 🙌`,

  /** Customer mengirim file lewat chat, padahal file harus lewat link upload. */
  useUploadLink: (uploadUrl: string, purpose: "reference" | "proof") =>
    purpose === "proof"
      ? `Makasih ya! 🙏 Tapi bukti pembayaran *tidak diterima lewat chat*, biar rapi & aman. Upload lewat link khusus ini ya 👇\n\n🔗 ${uploadUrl}`
      : `Makasih ya! 🙏 File/foto/dokumen *tidak diterima lewat chat*. Upload lewat link khusus ini biar langsung masuk ke pesananmu 👇\n\n🔗 ${uploadUrl}`,

  referenceFileViaChatNote: () =>
    `Noted! 🙏 File/foto yang kamu kirim di chat belum bisa kami proses. Nanti setelah pesanan tercatat, kamu dapat link upload khusus ya.\n\nKetik *SKIP* untuk lanjut, atau tulis link referensinya.`,

  askName: () => `👤 Terakhir, boleh tau nama kamu?`,

  orderCreated: (opts: { orderNumber: string; tier: ServiceTier; uploadUrl: string }) =>
    opts.tier === "HEAVY"
      ? `✅ *Brief proyek kamu sudah kami terima!*\n\n` +
        `Order ID: #${opts.orderNumber}\n\n` +
        `Karena ini pekerjaan teknis, tim KETUPAT akan *mereview brief* dulu (estimasi maksimal 1x24 jam) dan bisa jadi menghubungi kamu untuk diskusi singkat. Setelah itu penawaran harga kami kirim ke chat ini.\n\n` +
        `📎 *Upload referensi (opsional tapi sangat membantu):* desain/mockup, dokumen kebutuhan, contoh aplikasi, atau kode lama (.zip) lewat link khusus ini 👇\n🔗 ${opts.uploadUrl}\n\n` +
        `Mohon tunggu ya 🙌`
      : `✅ *Data pesanan kamu sudah diterima!*\n\n` +
        `Order ID: #${opts.orderNumber}\n\n` +
        `Tim KETUPAT akan memeriksa detail dan mengirim penawaran harga (biasanya kurang dari 1 jam).\n\n` +
        `📎 Punya file/foto/dokumen pendukung? Upload lewat link khusus ini (opsional) 👇\n🔗 ${opts.uploadUrl}\n\n` +
        `Mohon tunggu sebentar ya 🙌`,

  konsultasiCreated: (orderNumber: string) =>
    `✅ Sip, pertanyaan kamu udah tercatat!\n\n` +
    `Order ID: #${orderNumber}\n\n` +
    `Konsultasi ini *FREE* alias gratis 🙌 Admin KETUPAT bakal langsung gas chat kamu di sini buat bahas lebih lanjut, jadi bukan bot lagi yang balas ya. Tunggu bentar!`,

  /** Admin bisa menambahkan catatan saat mengirim jumlah pembayaran (quotation). */
  quotation: (opts: {
    orderNumber: string;
    serviceLabel: string;
    price: number;
    deadline: string;
    note?: string | null;
  }) =>
    `💰 *QUOTATION KETUPAT*\n\n` +
    `Order: #${opts.orderNumber}\n` +
    `Layanan: ${opts.serviceLabel}\n` +
    `Harga: ${formatRupiah(opts.price)}\n` +
    `Deadline: ${opts.deadline}\n` +
    (opts.note?.trim() ? `\n📝 *Catatan dari admin:*\n${opts.note.trim()}\n` : "") +
    `\nJika detail sudah sesuai, silakan lanjut ke pembayaran.\n\n` +
    `Ketik:\n1️⃣ LANJUT BAYAR\n2️⃣ TANYA ADMIN`,

  quotationInvalidChoice: () => `Ketik *1* buat LANJUT BAYAR atau *2* kalau masih mau TANYA ADMIN ya 🙏`,

  askAdminQuestion: () =>
    `💬 Sip, tulis aja pertanyaan/kendalanya. Admin KETUPAT bakal segera gas balas kok 🙌`,

  /** Info pembayaran + LINK UPLOAD bukti (bukan kirim foto di chat). */
  payment: (opts: { orderNumber: string; total: number; qrisUrl?: string | null; uploadUrl: string }) =>
    `💳 *PEMBAYARAN*\n\n` +
    `Order: #${opts.orderNumber}\n` +
    `Total: ${formatRupiah(opts.total)}\n\n` +
    (opts.qrisUrl
      ? `1️⃣ Buka & scan QRIS di link ini 👇\n🔗 ${opts.qrisUrl}\n\n`
      : `1️⃣ Admin akan mengirim metode pembayaran ya.\n\n`) +
    `2️⃣ Setelah bayar, *upload bukti pembayaran* lewat link khusus ini (bukan dikirim di chat) 👇\n🔗 ${opts.uploadUrl}\n\n` +
    `⚠️ Pastikan nominalnya sesuai: ${formatRupiah(opts.total)}.`,

  paymentNoQris: () =>
    `⚠️ Waduh, link QRIS belum ke-setting nih. Admin bakal segera hubungi kamu buat atur metode bayar lain ya 🙏`,

  /** Dikirim otomatis begitu customer selesai upload bukti lewat link. */
  proofReceived: (orderNumber: string) =>
    `✅ *Bukti pembayaran diterima!*\n\n` +
    `Order: #${orderNumber}\n\n` +
    `Mohon tunggu ya, pembayaranmu sedang *divalidasi oleh admin*. Begitu terkonfirmasi, kamu otomatis dapat kabar di sini 🙏`,

  /** Balasan bila customer chat saat bukti sedang divalidasi. */
  waitingValidation: (orderNumber: string) =>
    `⏳ Pembayaran order #${orderNumber} sedang *divalidasi oleh admin*. Mohon tunggu sebentar ya 🙏\n\nKetik *STATUS* untuk cek progres.`,

  /** Balasan bila customer chat "sudah bayar" tapi belum upload bukti. */
  askProofViaLink: (uploadUrl: string) =>
    `Siap! Biar bisa kami validasi, *upload bukti pembayarannya* dulu lewat link khusus ini ya 👇\n\n🔗 ${uploadUrl}\n\n` +
    `Begitu terupload, kami otomatis lanjut validasi 🙌`,

  referenceReceived: (opts: { orderNumber: string; fileCount: number }) =>
    `📎 *${opts.fileCount} file referensi* untuk order #${opts.orderNumber} sudah kami terima. Makasih ya! 🙌`,

  paymentVerified: (opts: { orderNumber: string; amount: number; note?: string | null }) =>
    `🎉 *PEMBAYARAN BERHASIL*\n\n` +
    `Order: #${opts.orderNumber}\n\n` +
    `Pembayaran sebesar ${formatRupiah(opts.amount)} telah dikonfirmasi.\n` +
    (opts.note?.trim() ? `\n📝 *Catatan admin:*\n${opts.note.trim()}\n` : "") +
    `\nPesanan kamu sekarang masuk ke tahap pengerjaan.\n\n` +
    statusProgress("PROCESSING") +
    `\n\nTerima kasih sudah menggunakan KETUPAT! 🚀`,

  paymentRejected: (opts: { orderNumber: string; note?: string | null; uploadUrl: string }) =>
    `⚠️ *PEMBAYARAN BELUM SESUAI*\n\nOrder: #${opts.orderNumber}\n\n` +
    `Bukti pembayaran yang kamu kirim belum bisa kami verifikasi.\n` +
    (opts.note?.trim() ? `\n📝 *Alasan:*\n${opts.note.trim()}\n` : "") +
    `\nMohon upload ulang bukti yang jelas dan sesuai nominal lewat link ini 👇\n🔗 ${opts.uploadUrl}`,

  /* ---------- Pesan otomatis saat admin mengubah status lewat web ---------- */

  statusWaitingQuotation: (orderNumber: string) =>
    `🧾 *UPDATE ORDER*\n\nOrder: #${orderNumber}\n\n` +
    `Pesanan kamu sedang kami cek untuk penentuan harga. Kami kabari begitu penawarannya siap ya 🙌`,

  statusPaymentReview: (orderNumber: string) =>
    `🔎 *UPDATE ORDER*\n\nOrder: #${orderNumber}\n\n` +
    `Pembayaran kamu sedang kami validasi. Mohon tunggu sebentar ya ⏳`,

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

  /** Admin bisa menambahkan catatan saat mengirim hasil pekerjaan. */
  completed: (opts: { orderNumber: string; resultUrl?: string | null; note?: string | null }) =>
    `🎉 *PESANAN SELESAI!*\n\n` +
    `Order #${opts.orderNumber} sudah selesai dikerjakan.\n\n` +
    (opts.resultUrl ? `📥 File hasil:\n${opts.resultUrl}\n\n` : "") +
    (opts.note?.trim() ? `📝 *Catatan dari admin:*\n${opts.note.trim()}\n\n` : "") +
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
    PAYMENT_REVIEW: "🔎 PEMBAYARAN SEDANG DIVALIDASI ADMIN",
    PAID: "✅ PEMBAYARAN TERKONFIRMASI",
    PROCESSING: "🔵 SEDANG DIKERJAKAN",
    REVIEW: "🔍 TAHAP REVIEW",
    COMPLETED: "🎉 SELESAI",
    CANCELLED: "❌ DIBATALKAN",
  };
  return map[status] ?? status;
}
