import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import { uuid } from "./crypto.js";

/**
 * File storage behind one API. STORAGE_DRIVER picks local disk (dev/test) or an
 * S3-compatible bucket (production). Callers only ever see relative keys such as
 * "requests/<uuid>.jpg", so DB rows are identical for both drivers. The bucket stays
 * private: files are streamed through the API after the service's auth check.
 */
export type StoredStream = { stream: Readable; size: number };

const root = () => path.resolve(env.UPLOAD_DIR);

/** Resolves a stored relative path safely (no traversal outside UPLOAD_DIR). */
export function resolveStored(rel: string): string {
  const abs = path.resolve(root(), rel);
  if (!abs.startsWith(root() + path.sep))
    throw new Error("Invalid storage path");
  return abs;
}

/** Rejects object keys that are absolute or contain traversal segments. */
function assertSafeKey(rel: string): void {
  if (
    path.posix.isAbsolute(rel) ||
    path.posix.normalize(rel) !== rel ||
    rel.startsWith("..")
  )
    throw new Error("Invalid storage path");
}

let s3: S3Client | null = null;
function client(): S3Client {
  s3 ??= new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
  return s3;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

/** Saves bytes under <folder>/<random>.<ext>; returns the relative key stored in DB. */
export async function saveFile(
  folder: string,
  ext: string,
  data: Buffer,
): Promise<string> {
  const rel = path.posix.join(folder, `${uuid()}.${ext}`);
  if (env.STORAGE_DRIVER === "s3") {
    await client().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: rel,
        Body: data,
        ContentType: MIME_BY_EXT[ext] ?? "application/octet-stream",
      }),
    );
    return rel;
  }
  const abs = path.join(root(), rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data, { mode: 0o600 });
  return rel;
}

/** Opens a stored file for streaming; rejects when it is missing. */
export async function openStored(rel: string): Promise<StoredStream> {
  if (env.STORAGE_DRIVER === "s3") {
    assertSafeKey(rel);
    const out = await client().send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: rel }),
    );
    if (!out.Body) throw new Error("Empty object body");
    // In Node the SDK body is an http IncomingMessage, i.e. a Readable.
    return { stream: out.Body as Readable, size: out.ContentLength ?? 0 };
  }
  const abs = resolveStored(rel);
  const s = await stat(abs);
  return { stream: createReadStream(abs), size: s.size };
}
