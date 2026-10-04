import { z } from "zod";
import type { AppContext } from "../types";
import { loginAdmin } from "../services/auth.service";
import { HttpError, readJson } from "../lib/http";
import { prisma } from "../lib/prisma";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function login(c: AppContext) {
  const { email, password } = loginSchema.parse(await readJson(c));
  const result = await loginAdmin(email, password);
  if (!result) throw new HttpError(401, "Email atau password salah");
  return c.json(result);
}

export async function me(c: AppContext) {
  const adminInfo = c.get("admin");
  if (!adminInfo) throw new HttpError(401, "Unauthorized");
  const admin = await prisma.admin.findUnique({
    where: { id: adminInfo.id },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  if (!admin) throw new HttpError(404, "Admin not found");
  return c.json(admin);
}
