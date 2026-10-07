import { describe, it, expect } from "vitest";
import { isValidDeadline, isValidDescription, isValidDetail, isValidName, isValidReference } from "../src/bot/bot.handlers";

describe("validasi inputan customer", () => {
  it("deskripsi minimal 10 karakter", () => {
    expect(isValidDescription("tugas")).toBe(false);
    expect(isValidDescription("Buat makalah tentang ekonomi digital 10 halaman")).toBe(true);
  });

  it("jawaban detail minimal 2 karakter", () => {
    expect(isValidDetail("a")).toBe(false);
    expect(isValidDetail("Python")).toBe(true);
  });

  it("deadline harus berupa tanggal/durasi/kata waktu", () => {
    expect(isValidDeadline("30 September 2026")).toBe(true);
    expect(isValidDeadline("besok sore")).toBe(true);
    expect(isValidDeadline("3 hari lagi")).toBe(true);
    expect(isValidDeadline("asdfgh")).toBe(false);
    expect(isValidDeadline("ok")).toBe(false);
  });

  it("nama hanya huruf (tanpa link/angka)", () => {
    expect(isValidName("Budi Santoso")).toBe(true);
    expect(isValidName("Siti-Aisyah")).toBe(true);
    expect(isValidName("http://spam.com")).toBe(false);
    expect(isValidName("12345")).toBe(false);
    expect(isValidName("A")).toBe(false);
  });

  it("referensi maksimal 500 karakter", () => {
    expect(isValidReference("https://figma.com/file/abc")).toBe(true);
    expect(isValidReference("x".repeat(501))).toBe(false);
  });
});
