import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { uuid } from "./crypto.js";

const root = () => path.resolve(env.UPLOAD_DIR);

/** Saves bytes under UPLOAD_DIR/<folder>/<random>.<ext>; returns the relative path stored in DB. */
export async function saveFile(
  folder: string,
  ext: string,
  data: Buffer,
): Promise<string> {
  const rel = path.posix.join(folder, `${uuid()}.${ext}`);
  const abs = path.join(root(), rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data, { mode: 0o600 });
  return rel;
}

/** Resolves a stored relative path safely (no traversal outside UPLOAD_DIR). */
export function resolveStored(rel: string): string {
  const abs = path.resolve(root(), rel);
  if (!abs.startsWith(root() + path.sep))
    throw new Error("Invalid storage path");
  return abs;
}

export async function openStored(rel: string) {
  const abs = resolveStored(rel);
  const s = await stat(abs);
  return { stream: createReadStream(abs), size: s.size };
}
