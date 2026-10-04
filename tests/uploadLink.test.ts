import { describe, it, expect, beforeAll } from "vitest";
import { initEnv } from "../src/config/env";
import { buildUploadUrl, createUploadToken, parseUploadToken } from "../src/services/upload-link.service";

beforeAll(() => {
  initEnv({ JWT_SECRET: "x".repeat(32), FRONTEND_URL: "https://ketupat.vercel.app/,https://*.vercel.app" });
});

describe("token link upload", () => {
  it("token valid dikembalikan jadi orderId", () => {
    expect(parseUploadToken(createUploadToken(42))).toBe(42);
  });

  it("token palsu / format salah ditolak", () => {
    expect(parseUploadToken("42-" + "a".repeat(20))).toBeNull();
    expect(parseUploadToken("abc")).toBeNull();
    expect(parseUploadToken("")).toBeNull();
  });

  it("link memakai domain frontend pertama saja", () => {
    expect(buildUploadUrl(7)).toMatch(/^https:\/\/ketupat\.vercel\.app\/upload\/7-[a-f0-9]{20}$/);
  });
});
