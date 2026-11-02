import { DEHRADUN } from "../../prisma/seed.js";
import { prisma } from "../../src/lib/prisma.js";

export const propertyInput = (over: Record<string, unknown> = {}) => ({
  label: "Test Flat",
  type: "FLAT",
  addressLine1: "12 Test Street",
  city: "Dehradun",
  state: "Uttarakhand",
  pincode: "248001",
  lat: DEHRADUN.lat,
  lng: DEHRADUN.lng,
  ...over,
});

export async function createProperty(
  ownerId: string,
  over: Record<string, unknown> = {},
) {
  return prisma.property.create({
    data: { ...propertyInput(over), ownerId } as Parameters<
      typeof prisma.property.create
    >[0]["data"],
  });
}

export async function addTenant(propertyId: string, tenantId: string) {
  return prisma.tenancy.create({
    data: { propertyId, tenantId, status: "ACTIVE", startDate: new Date() },
  });
}

export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let catN = 0;
export async function createCategory(slug?: string) {
  catN += 1;
  const s = slug ?? `cat-${catN}-${Date.now()}`;
  return prisma.serviceCategory.upsert({
    where: { slug: s },
    update: {},
    create: { slug: s, name: s, icon: "wrench" },
  });
}

export const requestInput = (
  propertyId: string,
  categoryId: string,
  over: Record<string, unknown> = {},
) => ({
  propertyId,
  categoryId,
  title: "Kitchen sink leaking",
  description: "Water drips from the pipe under the kitchen sink.",
  priority: "MEDIUM",
  ...over,
});
