/**
 * Membuat / memperbarui akun admin (jalankan dari komputer lokal, terhubung ke Neon).
 *   npm run seed:admin
 * Membaca SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME dan DATABASE_URL dari .dev.vars.
 * Password disimpan dengan PBKDF2 (format yang dipakai Worker). Hash bcrypt lama otomatis tergantikan.
 */
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";
import { hashPassword } from "../src/lib/password";

config({ path: ".dev.vars" });
config();

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL belum diisi di .dev.vars");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const email = process.env.SEED_ADMIN_EMAIL ?? "admin@ketupat.id";
    const password = process.env.SEED_ADMIN_PASSWORD;
    const name = process.env.SEED_ADMIN_NAME ?? "Admin KETUPAT";
    if (!password || password.length < 8) throw new Error("Isi SEED_ADMIN_PASSWORD (minimal 8 karakter) di .dev.vars");

    const passwordHash = await hashPassword(password);
    await prisma.admin.upsert({
      where: { email },
      update: { name, passwordHash },
      create: { email, name, passwordHash, role: "SUPERADMIN" },
    });
    console.log(`✅ Admin siap: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
