import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "dotenv/config";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@ketupat.id";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ketupat123";
  const name = process.env.SEED_ADMIN_NAME ?? "Admin KETUPAT";
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.admin.upsert({
    where: { email },
    update: { name, passwordHash },
    create: { email, name, passwordHash, role: "SUPERADMIN" },
  });
  console.log(`✅ Admin seeded: ${email}`);
}

main().finally(() => prisma.$disconnect());
