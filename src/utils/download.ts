import { logger } from "../utils/logger";
import { saveBytes } from "../lib/storage";

export interface DownloadedFile {
  relativePath: string;
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
 * Mengunduh file dari URL Fonnte (hanya valid ~30 menit) lalu menyimpannya ke database
 * (tabel uploads). Mengembalikan path publik + content-type asli dari server,
 * sehingga jenis file (foto/dokumen) bisa dideteksi walau `extension` dari Fonnte kosong.
 */
export async function downloadToUploads(
  remoteUrl: string,
  subdir: "incoming",
  extensionHint?: string
): Promise<DownloadedFile | null> {
  try {
    const response = await fetch(remoteUrl);
    if (!response.ok) {
      logger.error("Failed to download incoming attachment", { status: response.status, subdir });
      return null;
    }

    const contentType = response.headers.get("content-type");
    const bytes = await response.arrayBuffer();

    const ext =
      cleanExtension(extensionHint) ||
      extFromContentType(contentType) ||
      cleanExtension(remoteUrl.split("?")[0].split(".").pop()) ||
      "bin";

    const saved = await saveBytes(subdir, bytes, ext, contentType);
    return { relativePath: saved.relativePath, contentType, extension: ext };
  } catch (err) {
    logger.error("Error downloading incoming attachment", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
