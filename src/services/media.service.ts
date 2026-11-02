import { fileTypeFromBuffer } from "file-type";
import { AppError } from "../errors/AppError.js";
import { saveFile } from "../lib/storage.js";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const DOCUMENT_TYPES = [...IMAGE_TYPES, "application/pdf"] as const;

export type StoredFile = { path: string; mimeType: string; sizeBytes: number };

/** Verifies each upload by magic bytes (never trusts the client mime type) and stores it. */
export async function verifyAndStore(
  files: Express.Multer.File[],
  allowed: readonly string[],
  folder: string,
): Promise<StoredFile[]> {
  if (files.length === 0)
    throw AppError.validation([
      { path: "files", message: "Attach at least one file" },
    ]);
  const checked = await Promise.all(
    files.map(async (f, i) => {
      const type = await fileTypeFromBuffer(f.buffer);
      if (!type || !allowed.includes(type.mime)) {
        throw AppError.validation(
          [
            {
              path: `files.${i}`,
              message: `${f.originalname}: only ${allowed.join(", ")} allowed`,
              code: "INVALID_FILE_TYPE",
            },
          ],
          "Unsupported file type",
        );
      }
      return { f, type };
    }),
  );
  const out: StoredFile[] = [];
  for (const { f, type } of checked) {
    out.push({
      path: await saveFile(folder, type.ext, f.buffer),
      mimeType: type.mime,
      sizeBytes: f.size,
    });
  }
  return out;
}
