import { describe, it, expect } from "vitest";
import {
  parseServiceChoice,
  parseQuotationChoice,
  parseGlobalCommand,
  parseRating,
  isSkip,
} from "../src/bot/bot.handlers";

describe("parseServiceChoice", () => {
  it("accepts a numeric choice", () => {
    expect(parseServiceChoice("1")).toBe("TUGAS");
    expect(parseServiceChoice("2")).toBe("PPT");
    expect(parseServiceChoice("7")).toBe("KONSULTASI");
  });

  it("accepts a service name in any case", () => {
    expect(parseServiceChoice("Tugas")).toBe("TUGAS");
    expect(parseServiceChoice("PPT")).toBe("PPT");
    expect(parseServiceChoice("coding")).toBe("CODING");
    expect(parseServiceChoice("Website")).toBe("WEBSITE");
  });

  it("accepts common aliases", () => {
    expect(parseServiceChoice("web")).toBe("WEBSITE");
    expect(parseServiceChoice("aplikasi")).toBe("MOBILE_APP");
    expect(parseServiceChoice("konsul")).toBe("KONSULTASI");
  });

  it("returns null for unrecognized input", () => {
    expect(parseServiceChoice("apa aja deh")).toBeNull();
    expect(parseServiceChoice("9")).toBeNull();
  });
});

describe("parseQuotationChoice", () => {
  it("recognizes pay choice", () => {
    expect(parseQuotationChoice("1")).toBe("PAY");
    expect(parseQuotationChoice("lanjut bayar")).toBe("PAY");
  });
  it("recognizes ask-admin choice", () => {
    expect(parseQuotationChoice("2")).toBe("ASK_ADMIN");
    expect(parseQuotationChoice("tanya admin")).toBe("ASK_ADMIN");
  });
  it("returns null otherwise", () => {
    expect(parseQuotationChoice("bingung")).toBeNull();
  });
});

describe("parseGlobalCommand", () => {
  it("recognizes greeting/restart keywords", () => {
    expect(parseGlobalCommand("Halo")).toBe("RESTART");
    expect(parseGlobalCommand("HAI")).toBe("RESTART");
  });
  it("recognizes status keywords", () => {
    expect(parseGlobalCommand("status")).toBe("STATUS");
    expect(parseGlobalCommand("cek order")).toBe("STATUS");
  });
  it("returns null for regular text", () => {
    expect(parseGlobalCommand("Tugas kuliah tentang basis data")).toBeNull();
  });
});

describe("parseRating", () => {
  it("parses a lone digit rating", () => {
    expect(parseRating("5")).toEqual({ rating: 5, feedback: undefined });
  });
  it("parses a rating with feedback text", () => {
    expect(parseRating("5 mantap banget")).toEqual({ rating: 5, feedback: "mantap banget" });
  });
  it("returns null for out-of-range or invalid rating", () => {
    expect(parseRating("6")).toBeNull();
    expect(parseRating("bagus")).toBeNull();
  });
});

describe("isSkip", () => {
  it("recognizes skip keywords", () => {
    expect(isSkip("skip")).toBe(true);
    expect(isSkip("SKIP")).toBe(true);
    expect(isSkip("tidak ada")).toBe(true);
  });
  it("returns false for normal text", () => {
    expect(isSkip("ada, ini filenya")).toBe(false);
  });
});
