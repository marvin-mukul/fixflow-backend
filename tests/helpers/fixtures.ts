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

import { offsetKm } from "../../src/domain/geo.js";
import { DEHRADUN as CENTER } from "../../prisma/seed.js";
import { createUser, login } from "./auth.js";

export async function createWorker(
  categoryId: string,
  opts: {
    northKm?: number;
    radiusKm?: number;
    status?: "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";
    isAvailable?: boolean;
    jobsCompleted?: number;
    bayesian?: number;
    state?: string;
    gstin?: string | null;
  } = {},
) {
  const user = await createUser({ role: "WORKER" });
  const pos = offsetKm(CENTER, opts.northKm ?? 2);
  const profile = await prisma.workerProfile.create({
    data: {
      userId: user.id,
      baseLat: pos.lat,
      baseLng: pos.lng,
      serviceRadiusKm: opts.radiusKm ?? 20,
      verificationStatus: opts.status ?? "VERIFIED",
      isAvailable: opts.isAvailable ?? true,
      state: opts.state ?? "Uttarakhand",
      gstin: opts.gstin ?? null,
      categories: { create: { categoryId, yearsExperience: 3 } },
    },
  });
  if (opts.jobsCompleted !== undefined || opts.bayesian !== undefined) {
    await prisma.workerStats.create({
      data: {
        workerProfileId: profile.id,
        categoryId,
        jobsCompleted: opts.jobsCompleted ?? 0,
        bayesianScore: opts.bayesian ?? 4,
      },
    });
  }
  const { token } = await login(user.email);
  return { user, profile, token, auth: { Authorization: `Bearer ${token}` } };
}

export const quoteInput = (over: Record<string, unknown> = {}) => ({
  labourPaise: 40000,
  materialsPaise: 10000,
  etaHours: 4,
  notes: "Will replace the trap",
  ...over,
});
