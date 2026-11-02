// Idempotent seed — requirements.md §3.3. Safe to run any number of times.
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import { DEFAULT_SETTINGS } from "../src/domain/settings.js";
import { offsetKm, type LatLng } from "../src/domain/geo.js";
import type {
  PrismaClient,
  Prisma,
  GlobalRole,
  VerificationStatus,
} from "../src/generated/prisma/client.js";

export const DEMO_PASSWORD = "Demo@123";
export const DEHRADUN: LatLng = { lat: 30.3165, lng: 78.0322 };

export const CATEGORIES = [
  { slug: "plumbing", name: "Plumbing", icon: "droplets" },
  { slug: "electrical", name: "Electrical", icon: "zap" },
  { slug: "carpentry", name: "Carpentry", icon: "hammer" },
  { slug: "painting", name: "Painting", icon: "paint-roller" },
  {
    slug: "appliance-repair",
    name: "Appliance repair",
    icon: "washing-machine",
  },
  { slug: "cleaning", name: "Cleaning", icon: "sparkles" },
  { slug: "pest-control", name: "Pest control", icon: "bug" },
] as const;

type DemoWorker = {
  email: string;
  name: string;
  category: "plumbing" | "electrical";
  northKm: number;
  eastKm?: number;
  status: VerificationStatus;
  radiusKm?: number;
  gstin?: string;
};

export const DEMO_WORKERS: DemoWorker[] = [
  {
    email: "plumber1@demo.fixflow",
    name: "Ravi Plumber",
    category: "plumbing",
    northKm: 2,
    status: "VERIFIED",
  },
  {
    email: "plumber2@demo.fixflow",
    name: "Suresh Plumber",
    category: "plumbing",
    northKm: -5,
    eastKm: 3,
    status: "VERIFIED",
    gstin: "05ABCDE1234F1Z5",
  },
  {
    email: "plumber3@demo.fixflow",
    name: "Amit Plumber",
    category: "plumbing",
    northKm: 12,
    status: "VERIFIED",
  },
  {
    email: "electrician1@demo.fixflow",
    name: "Neha Electrician",
    category: "electrical",
    northKm: 3,
    eastKm: -2,
    status: "VERIFIED",
  },
  {
    email: "electrician2@demo.fixflow",
    name: "Vikas Electrician",
    category: "electrical",
    northKm: -8,
    status: "VERIFIED",
  },
  {
    email: "plumber-far@demo.fixflow",
    name: "Far Away Plumber",
    category: "plumbing",
    northKm: 25,
    status: "VERIFIED",
  },
  {
    email: "plumber-new@demo.fixflow",
    name: "Unverified Plumber",
    category: "plumbing",
    northKm: 4,
    status: "PENDING",
  },
];

const hash = (pw: string) => bcrypt.hash(pw, 12);

async function upsertUser(
  prisma: PrismaClient,
  data: {
    email: string;
    name: string;
    role: GlobalRole;
    passwordHash: string;
    mustChangePassword?: boolean;
    phone?: string;
  },
) {
  // `update: {}` keeps user-changed passwords/flags intact on re-seed.
  return prisma.user.upsert({
    where: { email: data.email },
    update: {},
    create: {
      email: data.email,
      name: data.name,
      globalRole: data.role,
      passwordHash: data.passwordHash,
      mustChangePassword: data.mustChangePassword ?? false,
      phone: data.phone ?? null,
    },
  });
}

export async function seed(prisma: PrismaClient): Promise<void> {
  const superPw = process.env.SEED_SUPERADMIN_PASSWORD;
  if (!superPw) throw new Error("SEED_SUPERADMIN_PASSWORD is required to seed");
  const superEmail =
    process.env.SEED_SUPERADMIN_EMAIL ?? "marvin.mukul@rubicotech.in";

  // Settings: only insert missing keys, never overwrite admin changes.
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.platformSetting.upsert({
      where: { key },
      update: {},
      create: { key, value: value as Prisma.InputJsonValue },
    });
  }

  const categories = new Map<string, string>();
  for (const c of CATEGORIES) {
    const row = await prisma.serviceCategory.upsert({
      where: { slug: c.slug },
      update: { name: c.name, icon: c.icon },
      create: c,
    });
    categories.set(c.slug, row.id);
  }

  await upsertUser(prisma, {
    email: superEmail,
    name: "Marvin Mukul",
    role: "SUPERADMIN",
    passwordHash: await hash(superPw),
    mustChangePassword: true,
  });

  const demoHash = await hash(DEMO_PASSWORD);
  await upsertUser(prisma, {
    email: "admin@demo.fixflow",
    name: "Demo Admin",
    role: "ADMIN",
    passwordHash: demoHash,
  });
  const owner = await upsertUser(prisma, {
    email: "owner@demo.fixflow",
    name: "Olivia Owner",
    role: "CUSTOMER",
    passwordHash: demoHash,
    phone: "+919800000001",
  });
  const tenant = await upsertUser(prisma, {
    email: "tenant@demo.fixflow",
    name: "Tarun Tenant",
    role: "CUSTOMER",
    passwordHash: demoHash,
    phone: "+919800000002",
  });

  let property = await prisma.property.findFirst({
    where: { ownerId: owner.id, label: "Rajpur Road Flat" },
  });
  if (!property) {
    property = await prisma.property.create({
      data: {
        ownerId: owner.id,
        label: "Rajpur Road Flat",
        type: "FLAT",
        addressLine1: "Flat 12B, Green Residency, Rajpur Road",
        city: "Dehradun",
        state: "Uttarakhand",
        pincode: "248001",
        lat: DEHRADUN.lat,
        lng: DEHRADUN.lng,
        isOwnerOccupied: false,
        autoApproveEmergency: true,
      },
    });
  }

  const activeTenancy = await prisma.tenancy.findFirst({
    where: { propertyId: property.id, tenantId: tenant.id, status: "ACTIVE" },
  });
  if (!activeTenancy) {
    await prisma.tenancy.create({
      data: {
        propertyId: property.id,
        tenantId: tenant.id,
        status: "ACTIVE",
        startDate: new Date("2026-01-01T00:00:00Z"),
      },
    });
  }

  for (const w of DEMO_WORKERS) {
    const user = await upsertUser(prisma, {
      email: w.email,
      name: w.name,
      role: "WORKER",
      passwordHash: demoHash,
    });
    const pos = offsetKm(DEHRADUN, w.northKm, w.eastKm ?? 0);
    const profile = await prisma.workerProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        bio: `${w.name} — demo worker`,
        baseLat: pos.lat,
        baseLng: pos.lng,
        serviceRadiusKm: w.radiusKm ?? 20,
        verificationStatus: w.status,
        verifiedAt: w.status === "VERIFIED" ? new Date() : null,
        state: "Uttarakhand",
        gstin: w.gstin ?? null,
      },
    });
    const categoryId = categories.get(w.category)!;
    await prisma.workerCategory.upsert({
      where: {
        workerProfileId_categoryId: { workerProfileId: profile.id, categoryId },
      },
      update: {},
      create: { workerProfileId: profile.id, categoryId, yearsExperience: 5 },
    });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { prisma } = await import("../src/lib/prisma.js");
  try {
    await seed(prisma);
    console.log("Seed complete");
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
