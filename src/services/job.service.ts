import {
  nextSubStatus,
  workerActions,
  type JobAction,
} from "../domain/jobStateMachine.js";
import { AppError } from "../errors/AppError.js";
import { prisma } from "../lib/prisma.js";
import { disputeRepository } from "../repositories/review.repository.js";
import {
  jobRepository,
  type JobWithContext,
} from "../repositories/job.repository.js";
import {
  requestEventRepository,
  requestRepository,
} from "../repositories/request.repository.js";
import { IMAGE_TYPES, verifyAndStore } from "./media.service.js";
import { notificationService } from "./notification.service.js";
import { relationsFor, requestPolicy, type Viewer } from "./request.policy.js";
import { toRequestDto } from "./request.service.js";
import { applyTransition } from "./requestWorkflow.service.js";
import { settingsService } from "./settings.service.js";
import { workerService } from "./worker.service.js";
import { availableActions } from "../domain/requestStateMachine.js";

const customerLink = (requestId: string) => `/requests/${requestId}`;

export function toJobDto(job: JobWithContext, user: Viewer) {
  const rel = relationsFor(job.request, user);
  const isWorker = rel.includes("WORKER");
  const quoteTotal = job.quote.labourPaise + job.quote.materialsPaise;
  return {
    id: job.id,
    requestId: job.requestId,
    subStatus: job.subStatus,
    requestStatus: job.request.status,
    title: job.request.title,
    category: job.request.category,
    priority: job.request.priority,
    quote: {
      id: job.quote.id,
      labourPaise: job.quote.labourPaise,
      materialsPaise: job.quote.materialsPaise,
      totalPaise: quoteTotal,
      etaHours: job.quote.etaHours,
      notes: job.quote.notes,
    },
    finalAmountPaise: job.finalAmountPaise ?? quoteTotal,
    scheduledStart: job.scheduledStart?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    confirmedAt: job.confirmedAt?.toISOString() ?? null,
    worker: {
      id: job.workerProfile.id,
      name: job.workerProfile.user.name,
      phone: job.workerProfile.user.phone,
    },
    // Accepted job: the assigned worker sees the exact address and the on-site contact.
    property: {
      label: job.request.property.label,
      addressLine1: job.request.property.addressLine1,
      addressLine2: job.request.property.addressLine2,
      city: job.request.property.city,
      state: job.request.property.state,
      pincode: job.request.property.pincode,
      lat: job.request.property.lat,
      lng: job.request.property.lng,
    },
    contact: {
      name: job.request.raisedBy.name,
      phone: job.request.raisedBy.phone,
    },
    afterPhotos: job.media.map((m) => ({
      id: m.id,
      url: `/api/v1/requests/${job.requestId}/media/${m.id}`,
      mimeType: m.mimeType,
    })),
    invoice: job.invoice,
    dispute: job.dispute
      ? {
          id: job.dispute.id,
          status: job.dispute.status,
          reason: job.dispute.reason,
          resolution: job.dispute.resolution,
        }
      : null,
    myReview: job.reviews.find((r) => r.reviewerId === user.id) ?? null,
    myRelations: rel,
    workerActions:
      isWorker && ["SCHEDULED", "IN_PROGRESS"].includes(job.request.status)
        ? workerActions(job.subStatus)
        : [],
    customerActions: availableActions(
      job.request.status,
      rel.filter((r) => r !== "WORKER"),
    ),
  };
}

async function loadVisible(jobId: string, user: Viewer) {
  const job = await jobRepository.findWithContext(jobId);
  requestPolicy.assertVisible(job?.request ?? null, user);
  return job!;
}

export const jobService = {
  async list(
    user: Viewer,
    q: { active: boolean; cursor?: string; limit: number },
  ) {
    let scope: { workerProfileId?: string; customerId?: string };
    if (user.globalRole === "WORKER")
      scope = {
        workerProfileId: (await workerService.requireProfile(user.id)).id,
      };
    else if (user.globalRole === "CUSTOMER") scope = { customerId: user.id };
    else scope = {};
    const page = await jobRepository.list(scope, q);
    return {
      items: page.items.map((j) => toJobDto(j, user)),
      nextCursor: page.nextCursor,
    };
  },

  async get(jobId: string, user: Viewer) {
    return toJobDto(await loadVisible(jobId, user), user);
  },

  /** en_route / arrive: sub-status only (request stays SCHEDULED). */
  async step(
    jobId: string,
    user: Viewer,
    action: Extract<JobAction, "en_route" | "arrive">,
  ) {
    await prisma.$transaction(async (tx) => {
      const job = await jobRepository.lockById(jobId, tx);
      const rel = requestPolicy.assertVisible(job?.request ?? null, user);
      if (!rel.includes("WORKER"))
        throw AppError.forbidden("Only the assigned worker can update the job");
      if (job!.request.status !== "SCHEDULED")
        throw AppError.invalidTransition(`Job is ${job!.request.status}`);
      const to = nextSubStatus(job!.subStatus, action);
      if (!to)
        throw AppError.invalidTransition(
          `Cannot ${action.replace("_", " ")} from ${job!.subStatus}`,
        );
      await jobRepository.moveSubStatus(
        jobId,
        job!.subStatus,
        { subStatus: to },
        tx,
      );
      await requestEventRepository.append(
        {
          requestId: job!.requestId,
          actorId: user.id,
          action: `job_${action}`,
          fromStatus: "SCHEDULED",
          toStatus: "SCHEDULED",
          payload: { subStatus: to },
        },
        tx,
      );
      const r = job!.request;
      await notificationService.notify(tx, [
        {
          userId: r.raisedById,
          type: "JOB_UPDATE",
          title:
            action === "en_route"
              ? "Worker is on the way"
              : "Worker has arrived",
          body: r.title,
          link: customerLink(r.id),
        },
      ]);
    });
    return this.get(jobId, user);
  },

  async start(jobId: string, user: Viewer) {
    const job = await loadVisible(jobId, user);
    await applyTransition(job.requestId, "start", user, {
      guardCtx: async (tx) => ({
        jobSubStatus: (await jobRepository.lockById(jobId, tx))!.subStatus,
      }),
      sideEffects: async (tx) => {
        await jobRepository.update(
          jobId,
          { subStatus: "WORKING", startedAt: new Date() },
          tx,
        );
      },
      notify: (r) => ({
        rows: [
          {
            userId: r.raisedById,
            type: "JOB_STARTED",
            title: "Work started",
            body: r.title,
            link: customerLink(r.id),
          },
        ],
      }),
    });
    return this.get(jobId, user);
  },

  async complete(
    jobId: string,
    user: Viewer,
    files: Express.Multer.File[],
    finalAmountPaise?: number,
  ) {
    const job = await loadVisible(jobId, user);
    if (!relationsFor(job.request, user).includes("WORKER"))
      throw AppError.forbidden("Only the assigned worker can complete the job");
    if (job.request.status !== "IN_PROGRESS" || job.subStatus !== "WORKING")
      throw AppError.invalidTransition("Start the job before completing it");
    if (files.length === 0)
      throw AppError.validation([
        { path: "files", message: "Attach at least one after photo" },
      ]);
    const quoteTotal = job.quote.labourPaise + job.quote.materialsPaise;
    if (
      finalAmountPaise !== undefined &&
      (finalAmountPaise <= 0 || finalAmountPaise > quoteTotal)
    )
      throw AppError.validation([
        {
          path: "finalAmountPaise",
          message:
            "Final amount must be above 0 and at most the accepted quote",
        },
      ]);
    const stored = await verifyAndStore(
      files,
      IMAGE_TYPES,
      `requests/${job.requestId}`,
    );
    await applyTransition(job.requestId, "complete", user, {
      sideEffects: async (tx) => {
        await requestRepository.addMedia(
          stored.map((s) => ({
            ...s,
            requestId: job.requestId,
            jobId,
            kind: "AFTER" as const,
            uploadedById: user.id,
          })),
          tx,
        );
        await jobRepository.update(
          jobId,
          {
            subStatus: "DONE",
            completedAt: new Date(),
            finalAmountPaise: finalAmountPaise ?? quoteTotal,
          },
          tx,
        );
      },
      notify: (r) => ({
        rows: [
          {
            userId: r.raisedById,
            type: "JOB_DONE",
            title: "Job marked complete",
            body: `Please confirm or dispute: ${r.title}`,
            link: customerLink(r.id),
          },
          {
            userId: r.payerUserId,
            type: "JOB_DONE",
            title: "Job marked complete",
            body: `Please confirm or dispute: ${r.title}`,
            link: customerLink(r.id),
          },
        ],
        email: true,
      }),
    });
    return this.get(jobId, user);
  },

  async confirm(jobId: string, user: Viewer) {
    const job = await loadVisible(jobId, user);
    const req = await applyTransition(job.requestId, "confirm", user, {
      data: {},
      sideEffects: async (tx) => {
        await jobRepository.update(jobId, { confirmedAt: new Date() }, tx);
      },
    });
    return {
      request: toRequestDto(req, relationsFor(req, user)),
      job: await this.get(jobId, user),
    };
  },

  async dispute(jobId: string, user: Viewer, reason: string) {
    const job = await loadVisible(jobId, user);
    await applyTransition(job.requestId, "dispute", user, {
      payload: { reason },
      sideEffects: async (tx) => {
        await disputeRepository.create(
          { jobId, raisedById: user.id, reason },
          tx,
        );
      },
      notify: (r) => ({
        rows: [
          {
            userId: job.workerProfile.userId,
            type: "JOB_DISPUTED",
            title: "Completion disputed",
            body: `${r.title}: ${reason}`,
            link: `/worker/jobs/${jobId}`,
          },
        ],
        email: true,
      }),
    });
    return this.get(jobId, user);
  },

  /** Scheduler: confirm jobs left in PENDING_SIGN_OFF longer than autoConfirmHours. */
  async autoConfirmDue(now = new Date()) {
    const s = await settingsService.getSettings();
    const due = await jobRepository.findDueForAutoConfirm(
      new Date(now.getTime() - s.autoConfirmHours * 3_600_000),
    );
    let n = 0;
    for (const j of due) {
      try {
        await applyTransition(j.requestId, "auto_confirm", "SYSTEM", {
          payload: { reason: `no response in ${s.autoConfirmHours} h` },
        });
        n++;
      } catch {
        // Raced with a manual confirm/dispute: fine.
      }
    }
    return n;
  },

  async listDisputes(status?: "OPEN" | "RESOLVED") {
    const rows = await disputeRepository.list(status);
    return {
      items: rows.map((d) => ({
        id: d.id,
        status: d.status,
        reason: d.reason,
        resolution: d.resolution,
        raisedBy: d.raisedBy,
        jobId: d.job.id,
        requestId: d.job.requestId,
        requestTitle: d.job.request.title,
        requestStatus: d.job.request.status,
        workerName: d.job.workerProfile.user.name,
        amountPaise: d.job.finalAmountPaise,
        createdAt: d.createdAt.toISOString(),
        resolvedAt: d.resolvedAt?.toISOString() ?? null,
      })),
    };
  },

  async resolveDispute(
    disputeId: string,
    admin: Viewer,
    outcome: "COMPLETE" | "CANCEL",
    resolution: string,
  ) {
    const d = await disputeRepository.findById(disputeId);
    if (!d) throw AppError.notFound("Dispute not found");
    if (d.status !== "OPEN")
      throw AppError.conflict("DISPUTE_RESOLVED", "Dispute already resolved");
    await applyTransition(
      d.job.requestId,
      outcome === "COMPLETE" ? "resolve_complete" : "resolve_cancel",
      admin,
      {
        payload: { disputeId, resolution },
        sideEffects: async (tx) => {
          await disputeRepository.resolve(
            disputeId,
            { resolution, resolvedById: admin.id },
            tx,
          );
        },
        notify: (r) => ({
          rows: [
            {
              userId: r.raisedById,
              type: "DISPUTE_RESOLVED",
              title: "Dispute resolved",
              body: `${r.title}: ${resolution}`,
              link: customerLink(r.id),
            },
            {
              userId: r.payerUserId,
              type: "DISPUTE_RESOLVED",
              title: "Dispute resolved",
              body: `${r.title}: ${resolution}`,
              link: customerLink(r.id),
            },
            ...(r.job
              ? [
                  {
                    userId: r.job.workerProfile.userId,
                    type: "DISPUTE_RESOLVED",
                    title: "Dispute resolved",
                    body: `${r.title}: ${resolution}`,
                    link: `/worker/jobs/${r.job.id}`,
                  },
                ]
              : []),
          ],
          email: true,
        }),
      },
    );
    return (await this.listDisputes()).items.find((x) => x.id === disputeId)!;
  },
};
