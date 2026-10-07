import { describe, it, expect } from "vitest";
import { crc16, makeDynamicQris, qrisMerchantName, validateQrisPayload } from "../src/lib/qris";
import { makeQrMatrix } from "../src/lib/qr";

const tlv = (id: string, v: string) => id + String(v.length).padStart(2, "0") + v;
const body =
  tlv("00", "01") + tlv("01", "11") +
  tlv("26", tlv("00", "ID.CO.EXAMPLE.WWW") + tlv("01", "936009990000012345") + tlv("03", "UMI")) +
  tlv("52", "5812") + tlv("53", "360") + tlv("58", "ID") + tlv("59", "KETUPAT STORE") + tlv("60", "SURABAYA") + "6304";
const STATIC = body + crc16(body);

describe("QRIS dinamis", () => {
  it("kode statis valid & nama merchant (spasi di dalam dipertahankan)", () => {
    expect(validateQrisPayload(STATIC)).toBeNull();
    expect(qrisMerchantName(STATIC)).toBe("KETUPAT STORE");
  });

  it("menolak kode rusak / bukan QRIS / checksum salah", () => {
    expect(validateQrisPayload("halo dunia")).not.toBeNull();
    expect(validateQrisPayload(STATIC.slice(0, 50))).not.toBeNull();
    expect(validateQrisPayload(STATIC.slice(0, -1) + "0")).not.toBeNull();
  });

  it("menyisipkan nominal (tag 54), mengubah 11 -> 12, dan checksum tetap valid", () => {
    const dyn = makeDynamicQris(STATIC, 75000);
    expect(validateQrisPayload(dyn)).toBeNull();
    expect(dyn).toContain("010212");
    expect(dyn).toContain("5405750005802ID");
    expect(dyn.slice(-4)).toBe(crc16(dyn.slice(0, -4)));
  });

  it("nominal lama diganti, bukan ditumpuk", () => {
    const again = makeDynamicQris(makeDynamicQris(STATIC, 75000), 12345);
    expect(again).toContain("540512345");
    expect(again).not.toContain("5405750");
  });

  it("QR code dibuat untuk payload QRIS", () => {
    const m = makeQrMatrix(makeDynamicQris(STATIC, 50000));
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.length % 4).toBe(1); // ukuran = 4*versi + 17
  });
});
