import { z } from "zod";
import "../lib/openapi.js";

export const IdParams = z.object({ id: z.string().uuid() });

export const CursorQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const pageOf = <T extends z.ZodType>(item: T, name: string) =>
  z
    .object({ items: z.array(item), nextCursor: z.string().uuid().nullable() })
    .openapi(name);

export const OkSchema = z.object({ ok: z.literal(true) }).openapi("Ok");

export const BEARER = [{ bearerAuth: [] }];
