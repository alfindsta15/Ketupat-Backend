import { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler";
import { loginAdmin } from "../services/auth.service";
import { HttpError } from "../middleware/error.middleware";
import { AuthedRequest } from "../middleware/auth.middleware";
import { prisma } from "../lib/prisma";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = loginSchema.parse(req.body);

  const result = await loginAdmin(email, password);
  if (!result) {
    throw new HttpError(401, "Email atau password salah");
  }

  res.json(result);
});

export const me = asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (!req.admin) throw new HttpError(401, "Unauthorized");
  const admin = await prisma.admin.findUnique({
    where: { id: req.admin.id },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  if (!admin) throw new HttpError(404, "Admin not found");
  res.json(admin);
});
