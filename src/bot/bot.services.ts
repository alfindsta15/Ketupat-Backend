import { ServiceCode } from "../utils/constants";

/**
 * LIGHT : pekerjaan ringan (tugas/PPT/CV) - alur singkat, penawaran cepat.
 * HEAVY : pekerjaan berat (coding/website/mobile app) - brief teknis lebih lengkap,
 *         wajib direview admin dulu sebelum penawaran dikirim.
 * FREE  : konsultasi gratis - langsung diteruskan ke admin.
 */
export type ServiceTier = "LIGHT" | "HEAVY" | "FREE";

export interface DetailQuestion {
  label: string; // tampil di dashboard admin
  prompt: string; // pertanyaan ke customer
  optional?: boolean; // boleh dijawab SKIP
}

export interface ServiceProfile {
  tier: ServiceTier;
  intro: string; // pesan setelah customer memilih layanan
  questions: DetailQuestion[];
  eta: string; // estimasi waktu penawaran
}

export const SERVICE_PROFILES: Record<ServiceCode, ServiceProfile> = {
  TUGAS: {
    tier: "LIGHT",
    intro:
      `Siap, kita bantu *tugasmu*! 📚\n\n` +
      `Ceritakan tugasnya dulu ya: topik/judul dan apa yang diminta dosen/guru. Boleh copy-paste soalnya langsung 📝`,
    questions: [
      { label: "Mata kuliah / pelajaran & jenjang", prompt: "🎓 Mata kuliah/pelajaran apa, dan jenjangnya (SMA/D3/S1/dll)?" },
      { label: "Jumlah halaman / soal", prompt: "📄 Perkiraan jumlah halaman atau jumlah soalnya berapa?" },
      { label: "Format pengumpulan", prompt: "🗂️ Dikumpulkan dalam format apa (Word/PDF/dll)? Ketik *SKIP* kalau bebas.", optional: true },
    ],
    eta: "biasanya kurang dari 1 jam",
  },
  PPT: {
    tier: "LIGHT",
    intro:
      `Mantap, kita buatkan *presentasi* yang keren! 🎨\n\n` +
      `Ceritakan topik presentasinya dan tujuannya (tugas kuliah, rapat, seminar, dll) 📝`,
    questions: [
      { label: "Jumlah slide", prompt: "🖼️ Kira-kira butuh berapa slide?" },
      { label: "Gaya desain", prompt: "🎨 Mau gaya desain seperti apa (minimalis/formal/colorful) dan ada warna favorit? Ketik *SKIP* kalau terserah kami.", optional: true },
      { label: "Bahasa", prompt: "🌐 Bahasa yang dipakai di slide? (Indonesia/Inggris)" },
    ],
    eta: "biasanya kurang dari 1 jam",
  },
  CV: {
    tier: "LIGHT",
    intro:
      `Oke, kita bantu bikin *CV* yang bikin HRD melirik! 📄\n\n` +
      `Ceritakan singkat latar belakangmu (pendidikan, pengalaman, skill utama) 📝`,
    questions: [
      { label: "Tujuan CV", prompt: "🎯 CV ini untuk apa? (lamaran kerja/magang/beasiswa)" },
      { label: "Posisi / bidang yang dituju", prompt: "💼 Posisi atau bidang yang dituju apa?" },
      { label: "Bahasa", prompt: "🌐 CV dalam bahasa apa? (Indonesia/Inggris)" },
    ],
    eta: "biasanya kurang dari 1 jam",
  },
  CODING: {
    tier: "HEAVY",
    intro:
      `Siap, kita bantu urusan *coding*! 💻\n\n` +
      `Karena ini pekerjaan teknis, aku akan tanya beberapa detail biar admin bisa menilai dengan akurat dan harganya pas.\n\n` +
      `Pertama, jelaskan dulu gambaran masalah/program yang kamu butuhkan 📝`,
    questions: [
      { label: "Bahasa / framework", prompt: "🧑‍💻 Pakai bahasa/framework apa? (mis. Python, Java, Laravel, React)" },
      { label: "Input & output yang diharapkan", prompt: "🔁 Program ini menerima input apa dan hasil (output) yang diharapkan seperti apa?" },
      { label: "Kondisi saat ini", prompt: "🧩 Sudah ada kode/proyek sebelumnya atau error yang perlu diperbaiki? Jelaskan singkat, atau ketik *SKIP* kalau mulai dari nol.", optional: true },
      { label: "Environment / ketentuan khusus", prompt: "⚙️ Ada ketentuan khusus? (versi, database, aturan dosen, library wajib). Ketik *SKIP* kalau tidak ada.", optional: true },
    ],
    eta: "maksimal 1x24 jam (admin review brief teknis dulu)",
  },
  WEBSITE: {
    tier: "HEAVY",
    intro:
      `Keren, kita bikinin *website*! 🌐\n\n` +
      `Karena ini proyek besar, aku tanya beberapa hal penting dulu ya, biar penawarannya akurat.\n\n` +
      `Pertama, ceritakan gambaran websitenya (untuk apa dan siapa penggunanya) 📝`,
    questions: [
      { label: "Jenis website", prompt: "🧭 Jenis websitenya apa? (company profile, toko online, portofolio, sistem informasi, dll)" },
      { label: "Fitur utama", prompt: "✨ Sebutkan fitur utama yang dibutuhkan (mis. login, katalog produk, checkout, dashboard admin, form kontak)." },
      { label: "Jumlah halaman", prompt: "📑 Perkiraan jumlah halaman/menu-nya berapa?" },
      { label: "Preferensi desain", prompt: "🎨 Ada preferensi desain (warna, gaya, contoh website yang kamu suka)? Ketik *SKIP* kalau terserah kami.", optional: true },
      { label: "Domain & hosting", prompt: "🌍 Sudah punya domain & hosting? Ketik *BELUM* kalau belum.", optional: true },
    ],
    eta: "maksimal 1x24 jam (admin review brief teknis dulu)",
  },
  MOBILE_APP: {
    tier: "HEAVY",
    intro:
      `Wah seru, kita bikinin *aplikasi mobile*! 📱\n\n` +
      `Aku tanya beberapa detail dulu ya biar admin bisa menghitung harga dengan tepat.\n\n` +
      `Pertama, ceritakan ide/gambaran aplikasinya (fungsi utama dan siapa penggunanya) 📝`,
    questions: [
      { label: "Platform", prompt: "📲 Platformnya apa? (Android / iOS / keduanya)" },
      { label: "Fitur utama", prompt: "✨ Sebutkan fitur utama yang dibutuhkan (mis. login, peta, notifikasi, pembayaran, chat)." },
      { label: "Backend & database", prompt: "🗄️ Butuh server/database/API sendiri? Atau sudah ada API yang tinggal dipakai? Ketik *SKIP* kalau belum tahu.", optional: true },
      { label: "Referensi aplikasi sejenis", prompt: "🔎 Ada aplikasi sejenis yang jadi contoh? Sebutkan namanya atau ketik *SKIP*.", optional: true },
    ],
    eta: "maksimal 1x24 jam (admin review brief teknis dulu)",
  },
  KONSULTASI: {
    tier: "FREE",
    intro:
      `Boleh banget, konsultasinya *GRATIS* kok! 💬\n\n` +
      `Tulis aja pertanyaan atau kendala kamu, nanti admin KETUPAT yang langsung balas 🙌`,
    questions: [],
    eta: "secepatnya",
  },
};

export function getServiceProfile(code: string): ServiceProfile {
  return SERVICE_PROFILES[code as ServiceCode] ?? SERVICE_PROFILES.TUGAS;
}
