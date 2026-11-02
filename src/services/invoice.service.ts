import { financialYear, invoiceNumber } from "../domain/money.js";
import { bayesianScore } from "../domain/ranking.js";
import { computeInvoice } from "../domain/pricing.js";
import { AppError } from "../errors/AppError.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { TxClient } from "../lib/prisma.js";
import {
  invoiceRepository,
  type InvoiceWithContext,
} from "../repositories/invoice.repository.js";
import { jobRepository } from "../repositories/job.repository.js";
import { workerRepository } from "../repositories/worker.repository.js";
import {
  notificationService,
  type AfterCommit,
} from "./notification.service.js";
import { requestPolicy, type Viewer } from "./request.policy.js";
import { onEnterStatus } from "./requestWorkflow.service.js";
import { settingsService } from "./settings.service.js";
import { workerService } from "./worker.service.js";

export function toInvoiceDto(
  inv: InvoiceWithContext,
  view: "customer" | "full",
) {
  const base = {
    id: inv.id,
    number: inv.number,
    jobId: inv.jobId,
    requestId: inv.job.requestId,
    requestTitle: inv.job.request.title,
    workerName: inv.job.workerProfile.user.name,
    payerUserId: inv.job.request.payerUserId,
    status: inv.status,
    servicePaise: inv.servicePaise,
    cgstPaise: inv.cgstPaise,
    sgstPaise: inv.sgstPaise,
    igstPaise: inv.igstPaise,
    totalPaise: inv.totalPaise,
    gstMode: inv.gstMode,
    issuedAt: inv.issuedAt.toISOString(),
    paidAt: inv.paidAt?.toISOString() ?? null,
    offlineMarkedAt: inv.offlineMarkedAt?.toISOString() ?? null,
    payments: inv.payments.map((p) => ({
      id: p.id,
      provider: p.provider,
      status: p.status,
      amountPaise: p.amountPaise,
      refundedPaise: p.refundedPaise,
      createdAt: p.createdAt.toISOString(),
    })),
  };
  if (view === "customer") return { ...base, breakdown: null };
  return {
    ...base,
    breakdown: {
      commissionPaise: inv.commissionPaise,
      commissionGstPaise: inv.commissionGstPaise,
      tcsPaise: inv.tcsPaise,
      workerPayoutPaise: inv.workerPayoutPaise,
      ratesSnapshot: inv.ratesSnapshot as Record<string, unknown>,
    },
  };
}

export const invoiceService = {
  /** Issues the invoice for a job once (on COMPLETED). Rates are snapshotted from current settings. */
  async issueForJob(tx: TxClient, jobId: string, afterCommit?: AfterCommit) {
    const job = await jobRepository.findWithContext(jobId, tx);
    if (!job || job.invoice) return null;
    const s = await settingsService.getSettings();
    const servicePaise =
      job.finalAmountPaise ?? job.quote.labourPaise + job.quote.materialsPaise;
    const b = computeInvoice(
      { servicePaise },
      { gstin: job.workerProfile.gstin, state: job.workerProfile.state },
      { state: job.request.property.state },
      s,
    );
    const now = new Date();
    const fy = financialYear(now);
    const seq = await invoiceRepository.nextSeq(fy, tx);
    const inv = await invoiceRepository.create(
      {
        jobId: job.id,
        number: invoiceNumber(fy, seq),
        ...b,
        ratesSnapshot: b.ratesSnapshot as Prisma.InputJsonValue,
        issuedAt: now,
      },
      tx,
    );
    await notificationService.notify(
      tx,
      [
        {
          userId: job.request.payerUserId,
          type: "INVOICE_ISSUED",
          title: "Invoice ready",
          body: `${inv.number}: ₹${(inv.totalPaise / 100).toFixed(2)} for ${job.request.title}`,
          link: `/requests/${job.requestId}`,
        },
        {
          userId: job.workerProfile.userId,
          type: "JOB_COMPLETED",
          title: "Job completed",
          body: `${job.request.title} was confirmed`,
          link: `/worker/jobs/${job.id}`,
        },
      ],
      afterCommit,
      true,
    );
    return inv;
  },

  async assertCanView(inv: InvoiceWithContext | null, user: Viewer) {
    const rel = requestPolicy.assertVisible(inv?.job.request ?? null, user);
    const isWorker = inv!.job.workerProfile.userId === user.id;
    if (
      !requestPolicy.isCustomerSide(rel) &&
      !isWorker &&
      !rel.includes("ADMIN")
    )
      throw AppError.notFound("Invoice not found");
    return isWorker || rel.includes("ADMIN")
      ? ("full" as const)
      : ("customer" as const);
  },

  async getByJob(jobId: string, user: Viewer) {
    const inv = await invoiceRepository.findByJobId(jobId);
    if (!inv) {
      const job = await jobRepository.findWithContext(jobId);
      requestPolicy.assertVisible(job?.request ?? null, user);
      throw new AppError(
        404,
        "INVOICE_NOT_ISSUED",
        "The invoice is issued when the job is completed",
      );
    }
    return toInvoiceDto(inv, await this.assertCanView(inv, user));
  },

  async get(id: string, user: Viewer) {
    const inv = await invoiceRepository.findById(id);
    return toInvoiceDto(inv!, await this.assertCanView(inv, user));
  },

  async earnings(userId: string) {
    const w = await workerService.requireProfile(userId);
    const rows = await invoiceRepository.listForWorker(w.id);
    const paid = rows.filter(
      (r) => r.status === "PAID" || r.status === "PAID_OFFLINE",
    );
    const pending = rows.filter((r) => r.status === "ISSUED");
    const sum = (xs: typeof rows) =>
      xs.reduce((a, r) => a + r.workerPayoutPaise, 0);
    return {
      totals: {
        paidPaise: sum(paid),
        pendingPaise: sum(pending),
        jobs: rows.length,
      },
      items: rows.map((r) => ({
        invoiceId: r.id,
        number: r.number,
        jobId: r.job.id,
        requestTitle: r.job.request.title,
        status: r.status,
        totalPaise: r.totalPaise,
        commissionPaise: r.commissionPaise + r.commissionGstPaise,
        tcsPaise: r.tcsPaise,
        workerPayoutPaise: r.workerPayoutPaise,
        issuedAt: r.issuedAt.toISOString(),
        paidAt: r.paidAt?.toISOString() ?? null,
      })),
    };
  },
};

// COMPLETED (confirm, auto-confirm, dispute resolved as complete): invoice + completed-jobs stat.
onEnterStatus("COMPLETED", async (tx, req, afterCommit) => {
  if (!req.job) return;
  if (!req.job.confirmedAt)
    await jobRepository.update(req.job.id, { confirmedAt: new Date() }, tx);
  const s = await settingsService.getSettings();
  const stats = await workerRepository.findStats(
    req.job.workerProfileId,
    req.categoryId,
    tx,
  );
  await workerRepository.upsertStats(
    req.job.workerProfileId,
    req.categoryId,
    { jobsCompleted: { increment: 1 } },
    {
      jobsCompleted: 1,
      bayesianScore:
        stats?.bayesianScore ??
        bayesianScore(0, 0, s.bayesianC, s.bayesianPriorMean),
    },
    tx,
  );
  await invoiceService.issueForJob(tx, req.job.id, afterCommit);
});
