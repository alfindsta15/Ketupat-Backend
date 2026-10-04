import { Router } from "express";
import { requireAdminAuth } from "../middleware/auth.middleware";
import { uploadResult } from "../middleware/upload.middleware";
import {
  listOrders,
  getOrder,
  createQuotation,
  changeOrderStatus,
  updateOrderNote,
  sendCustomerMessage,
  uploadOrderResult,
  listReviews,
} from "../controllers/order.controller";

const router = Router();

router.use(requireAdminAuth);

router.get("/", listOrders);
router.get("/reviews", listReviews);
router.get("/:id", getOrder);
router.post("/:id/quotation", createQuotation);
router.patch("/:id/status", changeOrderStatus);
router.patch("/:id/note", updateOrderNote);
router.post("/:id/message", sendCustomerMessage);
router.post("/:id/result", uploadResult.single("file"), uploadOrderResult);

export default router;
