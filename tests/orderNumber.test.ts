import { describe, it, expect } from "vitest";
import { formatOrderNumber, parseOrderNumber } from "../src/utils/orderNumber";

describe("formatOrderNumber", () => {
  it("pads to 5 digits with KTP- prefix", () => {
    expect(formatOrderNumber(1)).toBe("KTP-00001");
    expect(formatOrderNumber(42)).toBe("KTP-00042");
    expect(formatOrderNumber(100000)).toBe("KTP-100000");
  });
});

describe("parseOrderNumber", () => {
  it("parses with # prefix", () => {
    expect(parseOrderNumber("#KTP-00001")).toBe(1);
  });
  it("parses without # prefix", () => {
    expect(parseOrderNumber("KTP-00042")).toBe(42);
  });
  it("parses case-insensitively and without dash", () => {
    expect(parseOrderNumber("ktp00007")).toBe(7);
  });
  it("returns null for garbage input", () => {
    expect(parseOrderNumber("hello world")).toBeNull();
  });
});
