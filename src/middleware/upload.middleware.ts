import multer from "multer";
import path from "path";
import fs from "fs";
import { env } from "../config/env";
import { HttpError } from "./error.middleware";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const DOCUMENT_TYPES = [
  ...IMAGE_TYPES,
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-zip-compressed",
];

function makeStorage(subdir: string) {
  const dir = path.join(env.uploadDir, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const safeExt = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "");
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${safeExt}`);
    },
  });
}

function fileFilterFor(allowed: string[]) {
  return (_req: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (!allowed.includes(file.mimetype)) {
      return cb(new HttpError(400, `Tipe file tidak didukung: ${file.mimetype}`));
    }
    cb(null, true);
  };
}

const maxSize = () => env.maxUploadSizeMb * 1024 * 1024;

/** For admin uploading the static QRIS image (Settings -> Payment). */
export const uploadQris = multer({
  storage: makeStorage("qris"),
  fileFilter: fileFilterFor(IMAGE_TYPES),
  limits: { fileSize: maxSize() },
});

/** For admin uploading the finished result file for an order. */
export const uploadResult = multer({
  storage: makeStorage("results"),
  fileFilter: fileFilterFor(DOCUMENT_TYPES),
  limits: { fileSize: maxSize() * 4 }, // results can be a bit larger (zips, decks)
});
