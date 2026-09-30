import { Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler";
import { AuthedRequest } from "../middleware/auth.middleware";
import { HttpError } from "../middleware/error.middleware";
import { env } from "../config/env";
import { getActiveQris, setActiveQris, setActiveQrisLink, clearActiveQris } from "../services/settings.service";
import { logger } from "../utils/logger";

function toPublicUrl(relativePath: string): string {
  return `${env.appBaseUrl}${relativePath.startsWith("/") ? "" : "/"}${relativePath}`;
}

export const getQris = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const qris = await getActiveQris();
  res.json(qris);
});

export const uploadQrisController = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw new HttpError(400, "File QRIS wajib diupload");

  const relativePath = `/uploads/qris/${file.filename}`;
  await setActiveQris(toPublicUrl(relativePath), file.originalname);
  logger.info("QRIS updated", { filename: file.originalname });

  res.json({ url: toPublicUrl(relativePath), filename: file.originalname });
});

const qrisLinkSchema = z.object({ url: z.string().url("Link QRIS harus berupa URL yang valid") });

/** Sets the active QRIS from a manually-pasted link instead of an upload. */
export const setQrisLinkController = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { url } = qrisLinkSchema.parse(req.body);
  await setActiveQrisLink(url);
  logger.info("QRIS link updated", { url });
  res.json({ url, filename: "Link QRIS" });
});

export const deleteQrisController = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  await clearActiveQris();
  res.json({ deleted: true });
});
