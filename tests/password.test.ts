import { describe, it, expect } from "vitest";
import { hashPassword, verifyPbkdf2, isLegacyBcrypt } from "../src/lib/password";
import { parseDuration } from "../src/services/auth.service";

describe("password (PBKDF2)", () => {
  it("hash lalu verifikasi benar/salah", async () => {
    const hash = await hashPassword("rahasia123");
    expect(hash.startsWith("pbkdf2$100000$")).toBe(true);
    expect(await verifyPbkdf2("rahasia123", hash)).toBe(true);
    expect(await verifyPbkdf2("salah", hash)).toBe(false);
  });

  it("hash dua kali menghasilkan salt berbeda", async () => {
    expect(await hashPassword("sama")).not.toBe(await hashPassword("sama"));
  });

  it("mengenali hash bcrypt lama", () => {
    expect(isLegacyBcrypt("$2a$10$abcdefghijklmnopqrstuv")).toBe(true);
    expect(isLegacyBcrypt("pbkdf2$100000$x$y")).toBe(false);
  });
});

describe("parseDuration", () => {
  it.each([
    ["7d", 604800],
    ["12h", 43200],
    ["30m", 1800],
    ["90", 90],
    ["ngawur", 604800],
  ])("%s -> %i detik", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });
});
