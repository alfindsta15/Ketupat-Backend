import { Router } from "express";
import authRoutes from "./auth.routes";
import orderRoutes from "./order.routes";
import paymentRoutes from "./payment.routes";
import dashboardRoutes from "./dashboard.routes";
import settingsRoutes from "./settings.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/orders", orderRoutes);
router.use("/payments", paymentRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/settings", settingsRoutes);

export default router;
