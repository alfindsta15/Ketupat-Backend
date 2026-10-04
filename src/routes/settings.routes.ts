import { Router } from "express";
import { requireAdminAuth } from "../middleware/auth.middleware";
import { uploadQris } from "../middleware/upload.middleware";
import {
  getQris,
  uploadQrisController,
  setQrisLinkController,
  deleteQrisController,
} from "../controllers/settings.controller";

const router = Router();

router.use(requireAdminAuth);

router.get("/qris", getQris);
router.post("/qris", uploadQris.single("file"), uploadQrisController);
router.post("/qris/link", setQrisLinkController);
router.delete("/qris", deleteQrisController);

export default router;
