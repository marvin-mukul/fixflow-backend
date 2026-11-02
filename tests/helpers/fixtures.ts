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
