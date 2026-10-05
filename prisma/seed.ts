import { config } from "dotenv";
import pg from "pg";
import { hashPassword } from "../src/lib/password";

config({ path: ".dev.vars" });
config();

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL belum diisi di .dev.vars");

  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@ketupat.id";
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? "Admin KETUPAT";
  if (!password || password.length < 8) throw new Error("Isi SEED_ADMIN_PASSWORD (minimal 8 karakter) di .dev.vars");

  const passwordHash = await hashPassword(password);

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO admins (name, email, "passwordHash", role, "updatedAt")
       VALUES ($1, $2, $3, 'SUPERADMIN', NOW())
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name, "passwordHash" = EXCLUDED."passwordHash", "updatedAt" = NOW()`,
      [name, email, passwordHash]
    );
    console.log(`✅ Admin siap: ${email}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});