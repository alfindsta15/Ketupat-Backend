import { describe, it, expect } from "vitest";
import { messages, formatRupiah, statusProgress, statusLabel } from "../src/bot/bot.messages";

describe("formatRupiah", () => {
  it("formats a number as Indonesian Rupiah", () => {
    expect(formatRupiah(150000)).toBe("Rp150.000");
    expect(formatRupiah(1000000)).toBe("Rp1.000.000");
  });
});

describe("statusProgress", () => {
  it("shows all pending for WAITING_BRIEF", () => {
    const text = statusProgress("WAITING_BRIEF");
    expect(text).toContain("Brief");
    expect(text.match(/⏳/g)?.length).toBe(5);
  });

  it("shows processing in progress after payment is verified", () => {
    const text = statusProgress("PROCESSING");
    expect(text.split("\n")[0]).toContain("✅"); // Brief done
    expect(text.split("\n")[1]).toContain("✅"); // Payment done
    expect(text.split("\n")[2]).toContain("🔵"); // Pengerjaan in progress
  });

  it("shows everything done for COMPLETED", () => {
    const text = statusProgress("COMPLETED");
    expect(text.match(/✅/g)?.length).toBe(5);
  });
});

describe("statusLabel", () => {
  it("returns a human readable label", () => {
    expect(statusLabel("PROCESSING")).toContain("SEDANG DIKERJAKAN");
    expect(statusLabel("COMPLETED")).toContain("SELESAI");
  });
});

describe("messages.welcome", () => {
  it("includes the KETUPAT tagline and all 7 services", () => {
    const text = messages.welcome();
    expect(text).toContain("KETUPAT");
    expect(text).toContain("KERJAKAN TUGAS CEPAT & TEPAT");
    for (const label of ["Tugas", "PPT", "CV", "Coding", "Website", "Mobile App", "Konsultasi"]) {
      expect(text).toContain(label);
    }
  });
});

describe("messages.orderCreated", () => {
  it("includes the order number with a # prefix", () => {
    expect(messages.orderCreated("KTP-00001")).toContain("#KTP-00001");
  });
});
