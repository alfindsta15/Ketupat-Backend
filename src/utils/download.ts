import fs from "fs";
import path from "path";
import crypto from "crypto";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export interface DownloadedFile {
  relativePath: string;
  absolutePath: string;
  contentType: string | null;
  extension: string;
}

/** Membersihkan ekstensi dari Fonnte: ".JPG" / "jpg?x=1" -> "jpg". */
export function cleanExtension(raw?: string | null): string {
  if (!raw) return "";
  return raw.split("?")[0].replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 8);
}

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

function extFromContentType(contentType: string | null): string {
  if (!contentType) return "";
  return CONTENT_TYPE_TO_EXT[contentType.split(";")[0].trim().toLowerCase()] ?? "";
}

/**
 * Mengunduh file dari URL Fonnte (hanya valid ~30 menit) ke folder uploads
 * kita sendiri. Mengembalikan path publik + content-type asli dari server,
 * sehingga jenis file (foto/dokumen) bisa dideteksi walau `extension`
 * dari Fonnte kosong.
 */
export async function downloadToUploads(
  remoteUrl: string,
  subdir: string,
  extensionHint?: string
): Promise<DownloadedFile | null> {
  try {
    const response = await fetch(remoteUrl);
    if (!response.ok) {
      logger.error("Failed to download incoming attachment", { status: response.status, subdir });
      return null;
    }

    const contentType = response.headers.get("content-type");
    const buffer = Buffer.from(await response.arrayBuffer());

    const ext =
      cleanExtension(extensionHint) ||
      extFromContentType(contentType) ||
      cleanExtension(remoteUrl.split("?")[0].split(".").pop()) ||
      "bin";

    const filename = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;

    const dir = path.join(env.uploadDir, subdir);
    fs.mkdirSync(dir, { recursive: true });

    const absolutePath = path.join(dir, filename);
    fs.writeFileSync(absolutePath, buffer);

    return { relativePath: `/uploads/${subdir}/${filename}`, absolutePath, contentType, extension: ext };
  } catch (err) {
    logger.error("Error downloading incoming attachment", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
