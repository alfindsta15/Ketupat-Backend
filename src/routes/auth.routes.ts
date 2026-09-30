import { Router } from "express";
import { login, me } from "../controllers/auth.controller";
import { requireAdminAuth } from "../middleware/auth.middleware";
import { loginRateLimiter } from "../middleware/rateLimit.middleware";

const router = Router();

router.post("/login", loginRateLimiter, login);
router.get("/me", requireAdminAuth, me);

export default router;
