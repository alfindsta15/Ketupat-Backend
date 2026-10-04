import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Rahasia lokal disimpan di .dev.vars (format sama dengan .env) agar `wrangler dev` dan Prisma CLI
// memakai file yang sama. .env biasa tetap dibaca bila ada.
config({ path: ".dev.vars" });
config();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Placeholder agar `prisma generate` tidak gagal saat DATABASE_URL belum diisi.
    // `migrate deploy` akan gagal dengan jelas bila URL ini memang belum diganti.
    url: process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
