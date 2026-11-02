import { prisma, type TxClient } from "../lib/prisma.js";

export const adminRepository = {
  async stats(tx: TxClient = prisma) {
    const [
      usersByRole,
      requestsByStatus,
      jobs,
      completedJobs,
      disputes,
      paid,
      everOpened,
      accepted,
    ] = await Promise.all([
      tx.user.groupBy({
        by: ["globalRole"],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      tx.repairRequest.groupBy({ by: ["status"], _count: { _all: true } }),
      tx.job.count(),
      tx.job.count({ where: { request: { status: "COMPLETED" } } }),
      tx.dispute.count(),
      tx.invoice.aggregate({
        where: { status: { in: ["PAID", "PAID_OFFLINE"] } },
        _sum: {
          totalPaise: true,
          commissionPaise: true,
          commissionGstPaise: true,
        },
        _count: { _all: true },
      }),
      tx.repairRequest.count({ where: { approvedAt: { not: null } } }),
      tx.repairRequest.count({ where: { job: { isNot: null } } }),
    ]);
    const workers = await tx.workerProfile.groupBy({
      by: ["verificationStatus"],
      _count: { _all: true },
    });
    return {
      usersByRole,
      requestsByStatus,
      jobs,
      completedJobs,
      disputes,
      paid,
      everOpened,
      accepted,
      workers,
    };
  },

  listAdmins(tx: TxClient = prisma) {
    return tx.user.findMany({
      where: { globalRole: { in: ["ADMIN", "SUPERADMIN"] }, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
  },
};
