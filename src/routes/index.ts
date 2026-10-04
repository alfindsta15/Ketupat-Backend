import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAdminAuth } from "../middleware/auth.middleware";
import { loginRateLimiter } from "../middleware/rateLimit.middleware";
import { login, me } from "../controllers/auth.controller";
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
import { listPayments, verifyPaymentController, rejectPaymentController } from "../controllers/payment.controller";
import { getStats, listCustomers } from "../controllers/dashboard.controller";
import { getQris, uploadQrisController, setQrisLinkController, deleteQrisController } from "../controllers/settings.controller";
import { getUploadInfo, uploadProofPublic, uploadReferencePublic } from "../controllers/public.controller";

const api = new Hono<AppEnv>();

// --- Publik (tanpa login admin): akses dibatasi token HMAC pada link yang dikirim bot ---
const pub = new Hono<AppEnv>();
pub.get("/upload/:token", getUploadInfo);
pub.post("/upload/:token/proof", uploadProofPublic);
pub.post("/upload/:token/reference", uploadReferencePublic);
api.route("/public", pub);

// --- Auth ---
const auth = new Hono<AppEnv>();
auth.post("/login", loginRateLimiter, login);
auth.get("/me", requireAdminAuth, me);
api.route("/auth", auth);

// Semua sub-router di bawah ini WAJIB login admin: `use("*")` berlaku untuk semua path di dalamnya.
const orders = new Hono<AppEnv>();
orders.use("*", requireAdminAuth);
orders.get("/", listOrders);
orders.get("/reviews", listReviews); // harus sebelum /:id
orders.get("/:id", getOrder);
orders.post("/:id/quotation", createQuotation);
orders.patch("/:id/status", changeOrderStatus);
orders.patch("/:id/note", updateOrderNote);
orders.post("/:id/message", sendCustomerMessage);
orders.post("/:id/result", uploadOrderResult);
api.route("/orders", orders);

const payments = new Hono<AppEnv>();
payments.use("*", requireAdminAuth);
payments.get("/", listPayments);
payments.post("/:id/verify", verifyPaymentController);
payments.post("/:id/reject", rejectPaymentController);
api.route("/payments", payments);

const dashboard = new Hono<AppEnv>();
dashboard.use("*", requireAdminAuth);
dashboard.get("/stats", getStats);
dashboard.get("/customers", listCustomers);
api.route("/dashboard", dashboard);

const settings = new Hono<AppEnv>();
settings.use("*", requireAdminAuth);
settings.get("/qris", getQris);
settings.post("/qris", uploadQrisController);
settings.post("/qris/link", setQrisLinkController);
settings.delete("/qris", deleteQrisController);
api.route("/settings", settings);

export default api;
