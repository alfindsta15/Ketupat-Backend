import { describe, it, expect } from "vitest";
import { normalizePhoneNumber, formatPhoneForDisplay } from "../src/utils/phone";

describe("normalizePhoneNumber", () => {
  it("converts 08xxxxxxxxx correctly", () => {
    expect(normalizePhoneNumber("08123456789")).toBe("628123456789");
  });

  it("strips '+' and spaces/dashes", () => {
    expect(normalizePhoneNumber("+62 812-3456-789")).toBe("628123456789");
  });

  it("passes through an already-normalized number", () => {
    expect(normalizePhoneNumber("628123456789")).toBe("628123456789");
  });

  it("adds country code to a bare subscriber number", () => {
    expect(normalizePhoneNumber("8123456789")).toBe("628123456789");
  });

  it("strips WhatsApp JID suffix", () => {
    expect(normalizePhoneNumber("628123456789@s.whatsapp.net")).toBe("628123456789");
  });

  it("returns an empty string for empty input", () => {
    expect(normalizePhoneNumber("")).toBe("");
  });
});

describe("formatPhoneForDisplay", () => {
  it("converts back to local 0 format", () => {
    expect(formatPhoneForDisplay("628123456789")).toBe("08123456789");
  });
});
