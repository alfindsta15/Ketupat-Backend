import { Router } from "express";
import { requireAdminAuth } from "../middleware/auth.middleware";
import { getStats, listCustomers } from "../controllers/dashboard.controller";

const router = Router();

router.use(requireAdminAuth);

router.get("/stats", getStats);
router.get("/customers", listCustomers);

export default router;
