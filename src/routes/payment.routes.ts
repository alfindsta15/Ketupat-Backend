import { Router } from "express";
import { requireAdminAuth } from "../middleware/auth.middleware";
import { listPayments, verifyPaymentController, rejectPaymentController } from "../controllers/payment.controller";

const router = Router();

router.use(requireAdminAuth);

router.get("/", listPayments);
router.post("/:id/verify", verifyPaymentController);
router.post("/:id/reject", rejectPaymentController);

export default router;
