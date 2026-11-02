import {
  availableActions,
  type GuardCtx,
  type Relation,
} from "../domain/requestStateMachine.js";
import { AppError } from "../errors/AppError.js";
import type { RequestStatus } from "../generated/prisma/enums.js";
import { prisma, type TxClient } from "../lib/prisma.js";
import { openStored } from "../lib/storage.js";
import { categoryRepository } from "../repositories/category.repository.js";
import {
  requestEventRepository,
  requestRepository,
  type RequestWithContext,
} from "../repositories/request.repository.js";
import { quoteRepository } from "../repositories/quote.repository.js";
import { matchRepository } from "../repositories/worker.repository.js";
import { propertyRepository } from "../repositories/property.repository.js";
import { tenancyRepository } from "../repositories/tenancy.repository.js";
import type {
  CreateRequestInput,
  ListRequestsInput,
} from "../schemas/request.schema.js";
import { verifyAndStore, IMAGE_TYPES } from "./media.service.js";
import {
  notificationService,
  type AfterCommit,
} from "./notification.service.js";
import { relationOf } from "./property.policy.js";
import { onTenancyEnded } from "./property.service.js";
import { requestPolicy, relationsFor, type Viewer } from "./request.policy.js";
import {
  applyTransition,
  onEnterStatus,
  runAfterCommit,
  runEnterHooks,
} from "./requestWorkflow.service.js";
import { settingsService } from "./settings.service.js";

const MAX_BEFORE_PHOTOS = 5;
const link = (id: string) => `/requests/${id}`;

/** Extra guard context the state machine needs for some actions. */
async function guardCtx(
  tx: TxClient,
  req: RequestWithContext,
): Promise<GuardCtx> {
  const submittedQuotes = await quoteRepository.countSubmitted(req.id, tx);
  return {
    reopenedCount: req.reopenedCount,
    submittedQuotes,
    jobSubStatus: req.job?.subStatus ?? null,
  };
}

export function toRequestDto(
  req: RequestWithContext,
  relations: Relation[],
  ctx: GuardCtx = {},
) {
  const slots = Array.isArray(req.preferredSlots)
    ? (req.preferredSlots as { start: string; end: string }[])
    : [];
  return {
    id: req.id,
    title: req.title,
    description: req.description,
    priority: req.priority,
    status: req.status,
    property: {
      id: req.property.id,
      label: req.property.label,
      addressLine1: req.property.addressLine1,
      addressLine2: req.property.addressLine2,
      city: req.property.city,
      state: req.property.state,
      pincode: req.property.pincode,
      lat: req.property.lat,
      lng: req.property.lng,
    },
    category: req.category,
    raisedBy: req.raisedBy,
    payer: req.payer,
    preferredSlots: slots,
    quoteDeadline: req.quoteDeadline?.toISOString() ?? null,
    approvedAt: req.approvedAt?.toISOString() ?? null,
    searchRadiusKm: req.searchRadiusKm,
    reopenedCount: req.reopenedCount,
    cancelReason: req.cancelReason,
    media: req.media.map((m) => ({
      id: m.id,
      kind: m.kind,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      url: `/api/v1/requests/${req.id}/media/${m.id}`,
      createdAt: m.createdAt.toISOString(),
    })),
    jobId: req.job?.id ?? null,
    myRelations: relations,
    availableActions: availableActions(req.status, relations, {
      reopenedCount: req.reopenedCount,
      jobSubStatus: req.job?.subStatus ?? null,
      ...ctx,
    }),
    createdAt: req.createdAt.toISOString(),
    updatedAt: req.updatedAt.toISOString(),
  };
}

// On entering OPEN_FOR_QUOTES: set the quote deadline from the priority window (settings).
onEnterStatus("OPEN_FOR_QUOTES", async (tx, req) => {
  const s = await settingsService.getSettings();
  const hours = s.quoteWindowHours[req.priority];
  const deadline = new Date(Date.now() + hours * 3_600_000);
  await requestRepository.setQuoteDeadline(req.id, deadline, tx);
  req.quoteDeadline = deadline;
});

// Ending a tenancy: the tenant's open requests move to the owner (requirements.md §4.1).
onTenancyEnded(async (tx, { propertyId, tenantId, ownerId, actorId }) => {
  if (!ownerId) return;
  const moved = await requestRepository.transferOpenFromTenant(
    { propertyId, tenantId, ownerId },
    tx,
  );
  for (const r of moved) {
    await requestEventRepository.append(
      {
        requestId: r.id,
        actorId,
        action: "transfer_to_owner",
        fromStatus: r.status,
        toStatus: r.status,
        payload: { reason: "tenancy_ended", fromUserId: tenantId },
      },
      tx,
    );
  }
  if (moved.length) {
    await notificationService.notify(tx, [
      {
        userId: ownerId,
        type: "REQUESTS_TRANSFERRED",
        title: "Requests transferred to you",
        body: `${moved.length} open request(s) moved to you after a tenancy ended.`,
        link: "/requests",
      },
    ]);
  }
});

export const requestService = {
  async create(user: Viewer, input: CreateRequestInput) {
    const property = await propertyRepository.findVisible(
      input.propertyId,
      user.id,
    );
    if (!property) throw AppError.notFound("Property not found");
    const relation = relationOf(property, user.id)!;
    const category = await categoryRepository.findById(input.categoryId);
    if (!category || !category.isActive)
      throw AppError.validation([
        { path: "categoryId", message: "Unknown or inactive category" },
      ]);
    if (!property.ownerId)
      throw AppError.conflict(
        "PROPERTY_HAS_NO_OWNER",
        "This property has no owner yet",
      );

    let payerUserId = relation === "OWNER" ? user.id : property.ownerId;
    if (input.payerUserId && input.payerUserId !== payerUserId) {
      if (relation !== "OWNER")
        throw AppError.forbidden("Only the owner can choose the payer");
      const t = await tenancyRepository.findActive(
        property.id,
        input.payerUserId,
      );
      if (!t)
        throw AppError.validation([
          { path: "payerUserId", message: "Payer must be an active tenant" },
        ]);
      payerUserId = input.payerUserId;
    }

    const autoApprove =
      input.priority === "EMERGENCY" && property.autoApproveEmergency;
    const status: RequestStatus =
      relation === "OWNER" || autoApprove
        ? "OPEN_FOR_QUOTES"
        : "PENDING_APPROVAL";
    const settings = await settingsService.getSettings();
    const afterCommit: AfterCommit = [];

    const created = await prisma.$transaction(async (tx) => {
      const req = await requestRepository.create(
        {
          propertyId: property.id,
          raisedById: user.id,
          payerUserId,
          categoryId: category.id,
          title: input.title,
          description: input.description,
          priority: input.priority,
          status,
          preferredSlots: input.preferredSlots,
          searchRadiusKm: settings.matchRadiusKm,
          ...(status === "OPEN_FOR_QUOTES"
            ? {
                approvedAt: new Date(),
                approvedById: relation === "OWNER" ? user.id : null,
              }
            : {}),
        },
        tx,
      );
      await requestEventRepository.append(
        {
          requestId: req.id,
          actorId: user.id,
          action: "create",
          fromStatus: null,
          toStatus: status,
          payload:
            autoApprove && relation !== "OWNER"
              ? { autoApproved: "EMERGENCY" }
              : {},
        },
        tx,
      );
      await runEnterHooks(tx, req, afterCommit);
      if (status === "PENDING_APPROVAL") {
        await notificationService.notify(
          tx,
          [
            {
              userId: property.ownerId!,
              type: "APPROVAL_NEEDED",
              title: "Approval needed",
              body: `${req.title} — raised by your tenant`,
              link: link(req.id),
            },
          ],
          afterCommit,
          true,
        );
      } else if (relation !== "OWNER") {
        await notificationService.notify(tx, [
          {
            userId: property.ownerId!,
            type: "REQUEST_AUTO_APPROVED",
            title: "Emergency request opened",
            body: `${req.title} was auto-approved (emergency)`,
            link: link(req.id),
          },
        ]);
      }
      return (await requestRepository.findWithContext(req.id, tx))!;
    });
    await runAfterCommit(afterCommit);
    return toRequestDto(created, relationsFor(created, user));
  },

  async list(user: Viewer, q: ListRequestsInput) {
    const isAdmin =
      user.globalRole === "ADMIN" || user.globalRole === "SUPERADMIN";
    const page = await requestRepository.list(isAdmin ? null : user.id, q);
    return {
      items: page.items.map((r) => toRequestDto(r, relationsFor(r, user))),
      nextCursor: page.nextCursor,
    };
  },

  async get(id: string, user: Viewer) {
    const req = await requestRepository.findWithContext(id);
    const rel = requestPolicy.assertVisible(req, user);
    const ctx = await guardCtx(prisma, req!);
    return toRequestDto(req!, rel, ctx);
  },

  async approve(id: string, user: Viewer, tenantPays: boolean) {
    const req = await applyTransition(id, "approve", user, {
      data: { approvedAt: new Date(), approvedById: user.id },
      sideEffects: async (tx, r) => {
        if (tenantPays && r.raisedById !== r.property.ownerId) {
          await requestRepository.setPayer(r.id, r.raisedById, tx);
        }
      },
      payload: { tenantPays },
      notify: (r) => ({
        rows: [
          {
            userId: r.raisedById,
            type: "REQUEST_APPROVED",
            title: "Request approved",
            body: `${r.title} is now open for quotes`,
            link: link(r.id),
          },
        ],
        email: true,
      }),
    });
    return toRequestDto(req, relationsFor(req, user));
  },

  async reject(id: string, user: Viewer, reason: string) {
    const req = await applyTransition(id, "reject", user, {
      data: { cancelReason: reason },
      payload: { reason },
      notify: (r) => ({
        rows: [
          {
            userId: r.raisedById,
            type: "REQUEST_REJECTED",
            title: "Request rejected",
            body: `${r.title}: ${reason}`,
            link: link(r.id),
          },
        ],
        email: true,
      }),
    });
    return toRequestDto(req, relationsFor(req, user));
  },

  async cancel(id: string, user: Viewer, reason: string) {
    const req = await applyTransition(id, "cancel", user, {
      data: { cancelReason: reason },
      payload: { reason },
      sideEffects: async (tx, r) => {
        // Open quotes die with the request; a scheduled job is cancelled with it.
        await quoteRepository.rejectOpenForRequest(r.id, tx);
      },
      notify: (r) => ({
        rows: [
          {
            userId: r.raisedById,
            type: "REQUEST_CANCELLED",
            title: "Request cancelled",
            body: r.title,
            link: link(r.id),
          },
          {
            userId: r.payerUserId,
            type: "REQUEST_CANCELLED",
            title: "Request cancelled",
            body: r.title,
            link: link(r.id),
          },
          ...(r.property.ownerId
            ? [
                {
                  userId: r.property.ownerId,
                  type: "REQUEST_CANCELLED",
                  title: "Request cancelled",
                  body: r.title,
                  link: link(r.id),
                },
              ]
            : []),
          ...(r.job
            ? [
                {
                  userId: r.job.workerProfile.userId,
                  type: "JOB_CANCELLED",
                  title: "Job cancelled",
                  body: `${r.title}: ${reason}`,
                  link: `/worker/jobs/${r.job.id}`,
                },
              ]
            : []),
        ],
        email: Boolean(r.job),
      }),
    });
    return toRequestDto(req, relationsFor(req, user));
  },

  async reopen(id: string, user: Viewer) {
    const s = await settingsService.getSettings();
    const req = await applyTransition(id, "reopen", user, {
      guardCtx,
      data: {
        reopenedCount: { increment: 1 },
        searchRadiusKm: s.reopenRadiusKm,
      },
      payload: { radiusKm: s.reopenRadiusKm },
    });
    return toRequestDto(req, relationsFor(req, user));
  },

  async timeline(id: string, user: Viewer) {
    requestPolicy.assertVisible(
      await requestRepository.findWithContext(id),
      user,
    );
    const events = await requestEventRepository.listForRequest(id);
    return {
      items: events.map((e) => ({
        id: e.id,
        action: e.action,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actor: e.actor,
        payload: e.payload,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  },

  async uploadMedia(id: string, user: Viewer, files: Express.Multer.File[]) {
    const req = await requestRepository.findWithContext(id);
    const rel = requestPolicy.assertVisible(req, user);
    if (!requestPolicy.isCustomerSide(rel))
      throw AppError.forbidden("Only the requester side can add photos");
    if (!["PENDING_APPROVAL", "OPEN_FOR_QUOTES"].includes(req!.status))
      throw AppError.invalidTransition(
        "Photos can only be added before a quote is accepted",
      );
    const existing = await requestRepository.countMediaByKind(id, "BEFORE");
    if (existing + files.length > MAX_BEFORE_PHOTOS)
      throw AppError.validation([
        {
          path: "files",
          message: `At most ${MAX_BEFORE_PHOTOS} photos per request`,
        },
      ]);
    const stored = await verifyAndStore(files, IMAGE_TYPES, `requests/${id}`);
    await requestRepository.addMedia(
      stored.map((s) => ({
        requestId: id,
        kind: "BEFORE" as const,
        uploadedById: user.id,
        ...s,
      })),
    );
    return this.get(id, user);
  },

  /** Media is served only to users who can see the request (or matched leads, Step 6). */
  async openMedia(id: string, mediaId: string, user: Viewer) {
    const req = await requestRepository.findWithContext(id);
    if (!req) throw AppError.notFound();
    const visible =
      relationsFor(req, user).length > 0 ||
      (user.globalRole === "WORKER" &&
        (await matchRepository.existsForUser(id, user.id)));
    if (!visible) throw AppError.notFound();
    const media = await requestRepository.findMedia(id, mediaId);
    if (!media) throw AppError.notFound();
    const file = await openStored(media.path).catch(() => {
      throw AppError.notFound("File missing");
    });
    return { ...file, mimeType: media.mimeType };
  },

  /** Scheduler: owners get one reminder for requests pending approval > 24 h. */
  async sendApprovalReminders(now = new Date()) {
    const due = await requestRepository.findPendingApprovalBefore(
      new Date(now.getTime() - 24 * 3_600_000),
    );
    for (const r of due) {
      const afterCommit: AfterCommit = [];
      await prisma.$transaction(async (tx) => {
        const claimed = await requestRepository.claimReminder(r.id, now, tx);
        if (!claimed || !r.property.ownerId) return;
        await notificationService.notify(
          tx,
          [
            {
              userId: r.property.ownerId,
              type: "APPROVAL_REMINDER",
              title: "Approval still pending",
              body: `${r.title} has been waiting over 24 hours`,
              link: link(r.id),
            },
          ],
          afterCommit,
          true,
        );
      });
      await runAfterCommit(afterCommit);
    }
    return due.length;
  },
};
