import { z } from "zod";
import { SettingsSchema } from "../domain/settings.js";
import "../lib/openapi.js";
import { PasswordSchema } from "./auth.schema.js";
import { WorkerProfileDto } from "./worker.schema.js";

export const WorkerQueueQuery = z.object({
  status: z.enum(["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"]).optional(),
});

export const AdminWorkerDto = WorkerProfileDto.extend({
  email: z.string(),
  phone: z.string().nullable(),
  createdAt: z.string(),
  idDocumentUrl: z.string().nullable(),
}).openapi("AdminWorker");

export const AdminWorkerList = z
  .object({ items: z.array(AdminWorkerDto) })
  .openapi("AdminWorkerList");
export const ReasonBody = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .openapi("AdminReasonBody");

// Rebuilt here so the instance carries the OpenAPI extension (domain stays framework-free).
const Settings = z.object({ ...SettingsSchema.shape });
export const SettingsDto = Settings.openapi("PlatformSettings");
export const SettingsPatch = Settings.partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one setting",
  })
  .openapi("PlatformSettingsPatch", { example: { commissionPercent: 12 } });

export const CreateAdminBody = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: PasswordSchema,
  })
  .openapi("CreateAdminBody", {
    example: {
      name: "Second Admin",
      email: "admin2@fixflow.in",
      password: "Temp@1234",
    },
  });

export const AdminUserDto = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string(),
    globalRole: z.enum(["ADMIN", "SUPERADMIN"]),
    mustChangePassword: z.boolean(),
    lastLoginAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("AdminUser");
export const AdminUserList = z
  .object({ items: z.array(AdminUserDto) })
  .openapi("AdminUserList");

export const StatsDto = z
  .object({
    users: z.record(z.string(), z.number()),
    workers: z.record(z.string(), z.number()),
    requests: z.record(z.string(), z.number()),
    jobs: z.object({ total: z.number(), completed: z.number() }),
    money: z.object({
      gmvPaise: z.number().int(),
      commissionPaise: z.number().int(),
      commissionGstPaise: z.number().int(),
      paidInvoices: z.number().int(),
    }),
    rates: z.object({
      acceptance: z.number(),
      completion: z.number(),
      dispute: z.number(),
    }),
  })
  .openapi("AdminStats");
