import { beforeAll, describe, expect, it } from "vitest";
import { DEHRADUN, seed } from "../../prisma/seed.js";
import { matchingRepository } from "../../src/repositories/matching.repository.js";
import { settingsService } from "../../src/services/settings.service.js";
import { prisma, resetDb } from "../helpers/db.js";

async function counts() {
  const [
    users,
    categories,
    settings,
    properties,
    tenancies,
    workers,
    workerCats,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.serviceCategory.count(),
    prisma.platformSetting.count(),
    prisma.property.count(),
    prisma.tenancy.count(),
    prisma.workerProfile.count(),
    prisma.workerCategory.count(),
  ]);
  return {
    users,
    categories,
    settings,
    properties,
    tenancies,
    workers,
    workerCats,
  };
}

describe("seed", () => {
  beforeAll(async () => {
    await resetDb();
    await seed(prisma);
  });

  it("is idempotent", async () => {
    const before = await counts();
    await seed(prisma);
    expect(await counts()).toEqual(before);
    expect(before.categories).toBe(7);
    expect(before.workers).toBe(7);
  });

  it("creates the superadmin with mustChangePassword", async () => {
    const su = await prisma.user.findUniqueOrThrow({
      where: { email: "marvin.mukul@rubicotech.in" },
    });
    expect(su.globalRole).toBe("SUPERADMIN");
    expect(su.mustChangePassword).toBe(true);
    expect(su.passwordHash).not.toContain("Rubi");
  });

  it("radius query returns the 5 in-range verified workers and excludes the 25 km one", async () => {
    const plumbing = await prisma.serviceCategory.findUniqueOrThrow({
      where: { slug: "plumbing" },
    });
    const electrical = await prisma.serviceCategory.findUniqueOrThrow({
      where: { slug: "electrical" },
    });
    const p = await matchingRepository.findCandidates({
      ...DEHRADUN,
      radiusKm: 20,
      categoryId: plumbing.id,
    });
    const e = await matchingRepository.findCandidates({
      ...DEHRADUN,
      radiusKm: 20,
      categoryId: electrical.id,
    });
    expect(p).toHaveLength(3);
    expect(e).toHaveLength(2);
    expect(p.every((c) => c.distanceKm <= 20)).toBe(true);
    // 25 km plumber appears only with a 30 km reopen radius.
    const wide = await matchingRepository.findCandidates({
      ...DEHRADUN,
      radiusKm: 30,
      categoryId: plumbing.id,
    });
    expect(wide).toHaveLength(3); // still excluded: their own service radius is 20 km
  });

  it("settings service merges stored defaults", async () => {
    settingsService.invalidate();
    const s = await settingsService.getSettings();
    expect(s.commissionPercent).toBe(10);
    expect(s.quoteWindowHours.EMERGENCY).toBe(1);
  });
});
