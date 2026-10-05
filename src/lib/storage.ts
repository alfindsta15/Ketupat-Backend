import { env } from "../config/env";
import { prisma } from "./prisma";
import { HttpError } from "./http";

/** Folder logis (bagian awal `key`). Sama dengan struktur folder `uploads/` versi lama. */
export const UPLOAD_DIRS = ["qris", "results", "incoming", "proof", "reference"] as const;
export type UploadDir = (typeof UPLOAD_DIRS)[number];

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
export const CUSTOMER_IMAGE_TYPES = [...IMAGE_TYPES, "image/heic", "image/heif"];
export const DOCUMENT_TYPES = [
  ...IMAGE_TYPES,
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
];

export const maxBytes = () => env.maxUploadSizeMb * 1024 * 1024;

export function safeExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "";
  return filename.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);
}

function randomName(ext: string) {
  const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  return `${Date.now()}-${rand}${ext}`;
}

export interface StoredFile {
  filename: string; // nama file di R2
  relativePath: string; // /uploads/<dir>/<filename>
  originalName: string;
  mimeType: string;
  size: number;
}

async function putObject(dir: UploadDir, filename: string, body: Uint8Array, contentType: string) {
  await prisma.upload.create({
    data: { key: `${dir}/${filename}`, mimeType: contentType || "application/octet-stream", size: body.byteLength, data: body },
  });
}

/** Simpan File (dari multipart) ke database. */
export async function saveUpload(dir: UploadDir, file: File): Promise<StoredFile> {
  const filename = randomName(safeExtension(file.name));
  await putObject(dir, filename, new Uint8Array(await file.arrayBuffer()), file.type);
  return {
    filename,
    relativePath: `/uploads/${dir}/${filename}`,
    originalName: file.name,
    mimeType: file.type,
    size: file.size,
  };
}

/** Simpan bytes mentah (mis. lampiran yang diunduh dari Fonnte) ke database. */
export async function saveBytes(dir: UploadDir, bytes: ArrayBuffer, ext: string, contentType?: string | null) {
  const filename = randomName(ext ? `.${ext.replace(/^\./, "")}` : "");
  await putObject(dir, filename, new Uint8Array(bytes), contentType || "application/octet-stream");
  return { filename, relativePath: `/uploads/${dir}/${filename}` };
}

export interface ParsedForm {
  fields: Record<string, string>;
  files: File[];
}

/**
 * Pengganti multer: baca multipart, validasi tipe/ukuran/jumlah file.
 * Error dilempar sebagai HttpError dengan pesan yang ramah (Bahasa Indonesia).
 */
export async function parseMultipart(
  req: Request,
  opts: { field: string; allowed: string[]; maxFileBytes: number; maxFiles: number }
): Promise<ParsedForm> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.includes("multipart/form-data")) {
    return { fields: {}, files: [] };
  }

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length && length > opts.maxFileBytes * opts.maxFiles + 512 * 1024) {
    throw new HttpError(413, "Ukuran file terlalu besar. Perkecil file lalu coba lagi.");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Upload gagal dibaca. Coba lagi.");
  }

  const fields: Record<string, string> = {};
  const files: File[] = [];
  form.forEach((value, key) => {
    if (typeof value === "string") {
      fields[key] = value;
    } else if (key === opts.field) {
      files.push(value as File);
    }
  });

  if (files.length > opts.maxFiles) throw new HttpError(400, "Jumlah file melebihi batas.");
  for (const f of files) {
    if (!opts.allowed.includes(f.type)) throw new HttpError(400, `Tipe file tidak didukung: ${f.type || "tidak diketahui"}`);
    if (f.size > opts.maxFileBytes) throw new HttpError(413, "Ukuran file terlalu besar. Perkecil file lalu coba lagi.");
  }
  return { fields, files };
}
