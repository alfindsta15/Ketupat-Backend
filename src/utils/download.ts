import fs from "fs";
import path from "path";
import crypto from "crypto";
import { env } from "../config/env";
import { logger } from "../utils/logger";

/**
 * Downloads a remote file (e.g. a Fonnte webhook attachment URL, which is only
 * valid for ~30 minutes) into our own uploads directory so we keep a
 * permanent, locally-served copy.
 *
 * Returns a relative public path like "/uploads/proof/16889-abcd.jpg" that can
 * be served by Express static middleware and stored in the database.
 */
export async function downloadToUploads(
  remoteUrl: string,
  subdir: string,
  extensionHint?: string
): Promise<{ relativePath: string; absolutePath: string } | null> {
  try {
    const response = await fetch(remoteUrl);
    if (!response.ok) {
      logger.error("Failed to download incoming attachment", {
        status: response.status,
        subdir,
      });
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const ext = extensionHint || guessExtensionFromContentType(response.headers.get("content-type")) || "bin";
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;

    const dir = path.join(env.uploadDir, subdir);
    fs.mkdirSync(dir, { recursive: true });

    const absolutePath = path.join(dir, filename);
    fs.writeFileSync(absolutePath, buffer);

    return { relativePath: `/uploads/${subdir}/${filename}`, absolutePath };
  } catch (err) {
    logger.error("Error downloading incoming attachment", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function guessExtensionFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  };
  return map[contentType] ?? null;
}
