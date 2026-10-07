import { describe, it, expect } from "vitest";
import { nextPaymentSpec, splitPrice } from "../src/services/payment.service";

describe("DP 50% + pelunasan", () => {
  it("membagi harga jadi DP dan sisa yang jumlahnya tetap sama dengan total", () => {
    expect(splitPrice(100000)).toEqual({ dp: 50000, final: 50000 });
    const s = splitPrice(150001);
    expect(s.dp + s.final).toBe(150001);
  });

  it("tagihan pertama = DP", () => {
    expect(nextPaymentSpec(100000, [])).toEqual({ kind: "DP", amount: 50000 });
    expect(nextPaymentSpec(100000, [{ amount: 50000, status: "REJECTED" }])).toEqual({ kind: "DP", amount: 50000 });
  });

  it("setelah DP lunas, tagihan berikutnya = pelunasan sisa", () => {
    expect(nextPaymentSpec(100000, [{ amount: 50000, status: "PAID" }])).toEqual({ kind: "FINAL", amount: 50000 });
  });

  it("sudah lunas penuh -> tidak ada tagihan lagi", () => {
    expect(
      nextPaymentSpec(100000, [
        { amount: 50000, status: "PAID" },
        { amount: 50000, status: "PAID" },
      ])
    ).toBeNull();
  });
});
