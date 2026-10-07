-- Pembayaran dipecah: DP 50% di awal + pelunasan setelah pratinjau hasil.
-- Baris lama otomatis bernilai FULL (alur 1x bayar tetap berjalan seperti sebelumnya).
ALTER TABLE "payments" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'FULL';
