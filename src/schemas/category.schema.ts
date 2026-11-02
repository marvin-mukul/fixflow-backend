import { z } from "zod";
import "../lib/openapi.js";

export const CategoryDto = z
  .object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    icon: z.string(),
    isActive: z.boolean(),
  })
  .openapi("Category", {
    example: {
      id: "8a1d2c3b-4e5f-4a6b-9c8d-7e6f5a4b3c2d",
      slug: "plumbing",
      name: "Plumbing",
      icon: "droplets",
      isActive: true,
    },
  });

export const CategoryList = z
  .object({ items: z.array(CategoryDto) })
  .openapi("CategoryList");

export const CreateCategoryBody = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9-]{2,40}$/)
      .openapi({ example: "roofing" }),
    name: z.string().trim().min(2).max(60).openapi({ example: "Roofing" }),
    icon: z.string().trim().min(1).max(40).default("wrench"),
  })
  .openapi("CreateCategoryBody");

export const UpdateCategoryBody = z
  .object({
    name: z.string().trim().min(2).max(60),
    icon: z.string().trim().min(1).max(40),
    isActive: z.boolean(),
  })
  .partial()
  .openapi("UpdateCategoryBody");
