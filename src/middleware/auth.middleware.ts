import { NextFunction, Request, Response } from "express";
import { verifyAdminToken } from "../services/auth.service";

export interface AuthedRequest extends Request {
  admin?: { id: number; email: string; role: string };
}

export function requireAdminAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: missing token" });
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAdminToken(token);
    req.admin = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ message: "Unauthorized: invalid or expired token" });
  }
}
