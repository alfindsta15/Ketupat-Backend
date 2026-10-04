import { sign, verify } from "hono/jwt";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { hashPassword, isLegacyBcrypt, verifyPbkdf2 } from "../lib/password";
import { logger } from "../utils/logger";

export { hashPassword };

export interface AdminTokenPayload {
  sub: number;
  email: string;
  role: string;
}

/** "7d" / "12h" / "30m" / "3600" -> detik. */
export function parseDuration(input: string): number {
  const m = /^(\d+)\s*([smhd]?)$/i.exec(input.trim());
  if (!m) return 7 * 24 * 3600;
  const n = Number(m[1]);
  const unit = (m[2] || "s").toLowerCase();
  return n * (unit === "d" ? 86400 : unit === "h" ? 3600 : unit === "m" ? 60 : 1);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (isLegacyBcrypt(hash)) {
    // Hash lama dari versi Express (bcrypt). bcryptjs murni JS & lambat; di paket Free Workers
    // (CPU 10ms) ini bisa melewati batas -> jalankan `npm run seed:admin` sekali agar hash diganti PBKDF2.
    const bcrypt = (await import("bcryptjs")).default;
    return bcrypt.compare(plain, hash);
  }
  return verifyPbkdf2(plain, hash);
}

export async function signAdminToken(payload: AdminTokenPayload): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { sub: String(payload.sub), email: payload.email, role: payload.role, iat: now, exp: now + parseDuration(env.jwtExpiresIn) },
    env.jwtSecret,
    "HS256"
  );
}

export async function verifyAdminToken(token: string): Promise<AdminTokenPayload> {
  const p = (await verify(token, env.jwtSecret, "HS256")) as Record<string, unknown>;
  return { sub: Number(p.sub), email: String(p.email), role: String(p.role) };
}

export async function loginAdmin(email: string, password: string) {
  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin) return null;

  const valid = await verifyPassword(password, admin.passwordHash);
  if (!valid) return null;

  // Migrasi mulus: hash bcrypt lama diganti PBKDF2 setelah login sukses.
  if (isLegacyBcrypt(admin.passwordHash)) {
    try {
      await prisma.admin.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(password) } });
      logger.info("Password admin dimigrasikan ke PBKDF2", { adminId: admin.id });
    } catch {
      /* abaikan: login tetap sukses */
    }
  }

  const token = await signAdminToken({ sub: admin.id, email: admin.email, role: admin.role });
  return { token, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } };
}
