import { describe, it, expect } from "vitest";
import { buildFormFields, checkField, formText, parseFormReply } from "../src/bot/bot.form";

const pptFields = buildFormFields("PPT");
const all = pptFields.map((_, i) => i);

describe("form pesanan satu pesan", () => {
  it("form PPT memuat semua pertanyaan dalam satu pesan bernomor", () => {
    const t = formText("PPT");
    expect(t).toContain("1. ");
    expect(t).toContain(`${pptFields.length}. Nama kamu`);
    expect(pptFields.map((f) => f.key)).toEqual(["description", "d0", "d1", "d2", "deadline", "reference", "name"]);
  });

  it("konsultasi hanya butuh pertanyaan + nama", () => {
    expect(buildFormFields("KONSULTASI").map((f) => f.key)).toEqual(["description", "name"]);
  });

  it("membaca balasan bernomor lengkap", () => {
    const reply = [
      "1. Presentasi pemasaran digital untuk seminar kampus",
      "2. 15",
      "3. minimalis biru",
      "4. Indonesia",
      "5. 30 September 2026",
      "6. -",
      "7. Budi Santoso",
    ].join("\n");
    const m = parseFormReply(reply, pptFields, all);
    expect(m.get(0)).toContain("pemasaran digital");
    expect(m.get(1)).toBe("15");
    expect(m.get(6)).toBe("Budi Santoso");
  });

  it("label yang ikut tersalin dibuang", () => {
    const m = parseFormReply("1. Topik & tujuan presentasi: Rencana bisnis kafe\n2. Jumlah slide: 12", pptFields, all);
    expect(m.get(0)).toBe("Rencana bisnis kafe");
    expect(m.get(1)).toBe("12");
  });

  it("jawaban multi-baris menjadi satu jawaban", () => {
    const m = parseFormReply("1. Topik besar\nlanjutan topik\n2. 10", pptFields, all);
    expect(m.get(0)).toBe("Topik besar\nlanjutan topik");
    expect(m.get(1)).toBe("10");
  });

  it("daftar bernomor di dalam jawaban tidak dianggap nomor field", () => {
    const web = buildFormFields("WEBSITE");
    const reply = "1. Toko online baju untuk remaja\n2. Toko online\n3. Fitur:\n1. login\n2. keranjang\n4. 5 halaman";
    const m = parseFormReply(reply, web, web.map((_, i) => i));
    expect(m.get(0)).toBe("Toko online baju untuk remaja");
    expect(m.get(2)).toBe("1. login\n2. keranjang");
    expect(m.get(3)).toBe("5 halaman");
  });

  it("tanpa nomor: dipetakan urut jika jumlah baris cocok, atau 1 field = seluruh teks", () => {
    const lines = ["Topik presentasi bisnis kafe", "12", "-", "Indonesia", "besok sore", "-", "Siti"].join("\n");
    const m = parseFormReply(lines, pptFields, all);
    expect(m.get(1)).toBe("12");
    expect(m.get(6)).toBe("Siti");
    expect(parseFormReply("besok sore", pptFields, [4]).get(4)).toBe("besok sore");
  });

  it("validasi per field", () => {
    expect(checkField(pptFields[0], "singkat").status).toBe("invalid");
    expect(checkField(pptFields[0], "Presentasi pemasaran digital").status).toBe("ok");
    expect(checkField(pptFields[1], "-").status).toBe("invalid"); // wajib
    expect(checkField(pptFields[2], "-").status).toBe("skip"); // opsional
    expect(checkField(pptFields[4], "asdfgh").status).toBe("invalid");
    expect(checkField(pptFields[6], "http://spam.com").status).toBe("invalid");
  });
});
