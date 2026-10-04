import { describe, it, expect } from "vitest";
import { normalizePhoneNumber } from "../src/utils/phone";
import { formatOrderNumber, parseOrderNumber } from "../src/utils/orderNumber";
import { parseServiceChoice, parseQuotationChoice, parseRating, parseGlobalCommand } from "../src/bot/bot.handlers";
import { messages, statusProgress } from "../src/bot/bot.messages";

describe("normalizePhoneNumber", () => {
  it.each([
    ["08123456789", "628123456789"],
    ["+62 812-3456-789", "628123456789"],
    ["628123456789", "628123456789"],
    ["8123456789", "628123456789"],
    ["628123456789@s.whatsapp.net", "628123456789"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });
  it("returns empty string for empty input", () => {
    expect(normalizePhoneNumber("")).toBe("");
  });
});

describe("order number", () => {
  it("formats and parses", () => {
    expect(formatOrderNumber(1)).toBe("KTP-00001");
    expect(formatOrderNumber(123)).toBe("KTP-00123");
    expect(parseOrderNumber("#KTP-00042")).toBe(42);
    expect(parseOrderNumber("status ktp-00007")).toBe(7);
    expect(parseOrderNumber("halo")).toBeNull();
  });
});

describe("input parsing (valid & invalid)", () => {
  it("understands service numbers and names", () => {
    expect(parseServiceChoice("1")).toBe("TUGAS");
    expect(parseServiceChoice("Tugas")).toBe("TUGAS");
    expect(parseServiceChoice("TUGAS")).toBe("TUGAS");
    expect(parseServiceChoice("ppt")).toBe("PPT");
    expect(parseServiceChoice("6")).toBe("MOBILE_APP");
    expect(parseServiceChoice("Mobile App")).toBe("MOBILE_APP");
    expect(parseServiceChoice("7")).toBe("KONSULTASI");
  });
  it("rejects invalid service input", () => {
    expect(parseServiceChoice("9")).toBeNull();
    expect(parseServiceChoice("asdf")).toBeNull();
    expect(parseServiceChoice("")).toBeNull();
  });
  it("parses quotation choice", () => {
    expect(parseQuotationChoice("1")).toBe("PAY");
    expect(parseQuotationChoice("LANJUT BAYAR")).toBe("PAY");
    expect(parseQuotationChoice("tanya admin")).toBe("ASK_ADMIN");
    expect(parseQuotationChoice("hmm")).toBeNull();
  });
  it("parses rating", () => {
    expect(parseRating("5")).toEqual({ rating: 5, feedback: undefined });
    expect(parseRating("4 mantap")).toEqual({ rating: 4, feedback: "mantap" });
    expect(parseRating("0")).toBeNull();
    expect(parseRating("6")).toBeNull();
    expect(parseRating("bagus")).toBeNull();
  });
  it("detects global commands", () => {
    expect(parseGlobalCommand("Halo")).toBe("RESTART");
    expect(parseGlobalCommand("CEK ORDER")).toBe("STATUS");
    expect(parseGlobalCommand("status")).toBe("STATUS");
    expect(parseGlobalCommand("status #KTP-00001")).toBe("STATUS");
    expect(parseGlobalCommand("PPT 15 slide")).toBeNull();
  });
});

describe("messages", () => {
  it("welcome contains brand and menu", () => {
    const m = messages.welcome();
    expect(m).toContain("KETUPAT");
    expect(m).toContain("KERJAKAN TUGAS CEPAT & TEPAT");
    expect(m).toContain("7️⃣");
  });
  it("status progress after payment", () => {
    const p = statusProgress("PROCESSING");
    expect(p).toContain("Pengerjaan  🔵");
    expect(p).toContain("Selesai     ⏳");
  });
});
