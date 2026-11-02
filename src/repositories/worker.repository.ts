import type { Prisma } from "../generated/prisma/client.js";
import type { VerificationStatus } from "../generated/prisma/enums.js";
import { prisma, type TxClient } from "../lib/prisma.js";

export const workerInclude = {
  user: {
    select: { id: true, name: true, email: true, phone: true, status: true },
  },
  categories: {
    include: {
      category: { select: { id: true, slug: true, name: true, icon: true } },
    },
  },
  stats: true,
} satisfies Prisma.WorkerProfileInclude;

export type WorkerWithContext = Prisma.WorkerProfileGetPayload<{
  include: typeof workerInclude;
}>;

export const workerRepository = {
  findByUserId(userId: string, tx: TxClient = prisma) {
    return tx.workerProfile.findUnique({
      where: { userId },
      include: workerInclude,
    });
  },

  findById(id: string, tx: TxClient = prisma) {
    return tx.workerProfile.findUnique({
      where: { id },
      include: workerInclude,
    });
  },

  upsertProfile(
    userId: string,
    data: Omit<Prisma.WorkerProfileUncheckedCreateInput, "userId">,
    tx: TxClient = prisma,
  ) {
    return tx.workerProfile.upsert({
      where: { userId },
      create: { ...data, userId },
      update: data,
      include: workerInclude,
    });
  },

  update(
    id: string,
    data: Prisma.WorkerProfileUncheckedUpdateInput,
    tx: TxClient = prisma,
  ) {
    return tx.workerProfile.update({
      where: { id },
      data,
      include: workerInclude,
    });
  },

  async replaceCategories(
    workerProfileId: string,
    rows: { categoryId: string; yearsExperience: number }[],
    tx: TxClient,
  ) {
    await tx.workerCategory.deleteMany({ where: { workerProfileId } });
    if (rows.length) {
      await tx.workerCategory.createMany({
        data: rows.map((r) => ({ ...r, workerProfileId })),
      });
    }
  },

  listByStatus(status: VerificationStatus | undefined, tx: TxClient = prisma) {
    return tx.workerProfile.findMany({
      where: status ? { verificationStatus: status } : {},
      include: workerInclude,
      orderBy: { createdAt: "asc" },
      take: 200,
    });
  },

  /** Stats row per (worker, category); created lazily. */
  upsertStats(
    workerProfileId: string,
    categoryId: string,
    update: Prisma.WorkerStatsUncheckedUpdateInput,
    create: Partial<Prisma.WorkerStatsUncheckedCreateInput> = {},
    tx: TxClient = prisma,
  ) {
    return tx.workerStats.upsert({
      where: { workerProfileId_categoryId: { workerProfileId, categoryId } },
      create: { workerProfileId, categoryId, ...create },
      update,
    });
  },

  findStats(
    workerProfileId: string,
    categoryId: string,
    tx: TxClient = prisma,
  ) {
    return tx.workerStats.findUnique({
      where: { workerProfileId_categoryId: { workerProfileId, categoryId } },
    });
  },
};

export const matchRepository = {
  insertMany(
    rows: {
      requestId: string;
      workerProfileId: string;
      distanceKm: number;
      rankScore: number;
    }[],
    tx: TxClient = prisma,
  ) {
    if (!rows.length) return Promise.resolve({ count: 0 });
    return tx.requestMatch.createMany({ data: rows, skipDuplicates: true });
  },

  find(requestId: string, workerProfileId: string, tx: TxClient = prisma) {
    return tx.requestMatch.findUnique({
      where: { requestId_workerProfileId: { requestId, workerProfileId } },
    });
  },

  async existsForUser(
    requestId: string,
    userId: string,
    tx: TxClient = prisma,
  ) {
    const n = await tx.requestMatch.count({
      where: { requestId, workerProfile: { userId } },
    });
    return n > 0;
  },

  markViewed(
    requestId: string,
    workerProfileId: string,
    tx: TxClient = prisma,
  ) {
    return tx.requestMatch.updateMany({
      where: { requestId, workerProfileId, viewedAt: null },
      data: { viewedAt: new Date() },
    });
  },

  listForRequest(requestId: string, tx: TxClient = prisma) {
    return tx.requestMatch.findMany({ where: { requestId } });
  },
};
