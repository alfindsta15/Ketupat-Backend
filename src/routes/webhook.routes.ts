import { Router } from "express";
import { receiveFonnteWebhook } from "../controllers/webhook.controller";
import { webhookRateLimiter } from "../middleware/rateLimit.middleware";

const router = Router();

// Fonnte calls this endpoint for every inbound WhatsApp event.
router.post("/fonnte", webhookRateLimiter, receiveFonnteWebhook);

export default router;
