import { z } from "zod";
import "../lib/openapi.js";

export const PasswordSchema = z
  .string()
  .min(8, "At least 8 characters")
  .max(72, "At most 72 characters")
  .regex(/[a-z]/, "Needs a lowercase letter")
  .regex(/[A-Z]/, "Needs an uppercase letter")
  .regex(/[0-9]/, "Needs a digit")
  .openapi({ example: "Demo@1234" });

const Email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email())
  .openapi({ example: "owner@demo.fixflow" });

export const RegisterBody = z
  .object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .openapi({ example: "Olivia Owner" }),
    email: Email,
    password: PasswordSchema,
    phone: z
      .string()
      .regex(/^\+?[0-9]{10,15}$/, "Invalid phone number")
      .optional()
      .openapi({ example: "+919800000001" }),
    role: z.enum(["CUSTOMER", "WORKER"]).openapi({ example: "CUSTOMER" }),
  })
  .openapi("RegisterBody");

export const LoginBody = z
  .object({
    email: Email,
    password: z.string().min(1).openapi({ example: "Demo@123" }),
  })
  .openapi("LoginBody");

export const ChangePasswordBody = z
  .object({
    currentPassword: z.string().min(1).openapi({ example: "Rubi@123" }),
    newPassword: PasswordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ["newPassword"],
    message: "New password must differ from the current one",
  })
  .openapi("ChangePasswordBody");

export const UserDto = z
  .object({
    id: z.string().uuid(),
    email: z.string(),
    name: z.string(),
    phone: z.string().nullable(),
    globalRole: z.enum(["SUPERADMIN", "ADMIN", "CUSTOMER", "WORKER"]),
    mustChangePassword: z.boolean(),
    hasWorkerProfile: z.boolean(),
  })
  .openapi("User", {
    example: {
      id: "0b6f2a7e-1c1d-4b8e-9a43-0f6f1c2d3e4f",
      email: "owner@demo.fixflow",
      name: "Olivia Owner",
      phone: "+919800000001",
      globalRole: "CUSTOMER",
      mustChangePassword: false,
      hasWorkerProfile: false,
    },
  });

export const AuthResponse = z
  .object({ accessToken: z.string(), user: UserDto })
  .openapi("AuthResponse");

export type RegisterInput = z.infer<typeof RegisterBody>;
export type LoginInput = z.infer<typeof LoginBody>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordBody>;
export type UserDtoT = z.infer<typeof UserDto>;

export const DeleteAccountBody = z
  .object({ password: z.string().min(1) })
  .openapi("DeleteAccountBody", { example: { password: "Demo@123" } });
