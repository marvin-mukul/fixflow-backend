import type { Prisma } from "../generated/prisma/client.js";
import type { JobSubStatus } from "../generated/prisma/enums.js";
import { prisma, type TxClient } from "../lib/prisma.js";
import { customerVisible, requestInclude } from "./request.repository.js";

export const jobInclude = {
  request: { include: requestInclude },
  quote: true,
  workerProfile: {
    include: { user: { select: { id: true, name: true, phone: true } } },
  },
  invoice: {
    select: { id: true, number: true, status: true, totalPaise: true },
  },
  dispute: true,
  media: { where: { kind: "AFTER" }, orderBy: { createdAt: "asc" } },
  reviews: {
    select: {
      id: true,
      reviewerId: true,
      revieweeType: true,
      overall: true,
      createdAt: true,
      editedAt: true,
    },
  },
} satisfies Prisma.JobInclude;

export type JobWithContext = Prisma.JobGetPayload<{
  include: typeof jobInclude;
}>;

export const jobRepository = {
  create(data: Prisma.JobUncheckedCreateInput, tx: TxClient = prisma) {
    return tx.job.create({ data });
  },

  findWithContext(id: string, tx: TxClient = prisma) {
    return tx.job.findUnique({ where: { id }, include: jobInclude });
  },

  async lockById(id: string, tx: TxClient) {
    await tx.$queryRaw`SELECT id FROM job WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.job.findUnique({ where: { id }, include: jobInclude });
  },

  /** Only moves if still in `from` (guards against concurrent double-clicks). */
  async moveSubStatus(
    id: string,
    from: JobSubStatus,
    data: Prisma.JobUpdateManyMutationInput,
    tx: TxClient = prisma,
  ) {
    const r = await tx.job.updateMany({ where: { id, subStatus: from }, data });
    return r.count === 1;
  },

  update(
    id: string,
    data: Prisma.JobUncheckedUpdateInput,
    tx: TxClient = prisma,
  ) {
    return tx.job.update({ where: { id }, data });
  },

  async list(
    scope: { workerProfileId?: string; customerId?: string },
    f: { active?: boolean; cursor?: string; limit: number },
    tx: TxClient = prisma,
  ) {
    const where: Prisma.JobWhereInput = {
      AND: [
        scope.workerProfileId ? { workerProfileId: scope.workerProfileId } : {},
        scope.customerId ? { request: customerVisible(scope.customerId) } : {},
        f.active
          ? {
              request: {
                status: {
                  in: [
                    "SCHEDULED",
                    "IN_PROGRESS",
                    "PENDING_SIGN_OFF",
                    "DISPUTED",
                  ],
                },
              },
            }
          : {},
      ],
    };
    const rows = await tx.job.findMany({
      where,
      include: jobInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: f.limit + 1,
      ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > f.limit;
    const items = hasMore ? rows.slice(0, f.limit) : rows;
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
  },

  findDueForAutoConfirm(cutoff: Date, tx: TxClient = prisma) {
    return tx.job.findMany({
      where: {
        completedAt: { lt: cutoff },
        request: { status: "PENDING_SIGN_OFF" },
      },
      select: { id: true, requestId: true },
      take: 100,
    });
  },
};
