import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";
import { verifyAdminToken } from "../services/auth.service";

export const requireAdminAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return c.json({ message: "Unauthorized: missing token" }, 401);
  }

  try {
    const payload = await verifyAdminToken(header.slice("Bearer ".length));
    c.set("admin", { id: payload.sub, email: payload.email, role: payload.role });
  } catch {
    return c.json({ message: "Unauthorized: invalid or expired token" }, 401);
  }
  await next();
});
