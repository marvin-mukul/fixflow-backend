import type { Prisma } from "../generated/prisma/client.js";
import type { Priority, RequestStatus } from "../generated/prisma/enums.js";
import { prisma, type TxClient } from "../lib/prisma.js";

export const TERMINAL_STATUSES: RequestStatus[] = [
  "COMPLETED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
];

export const requestInclude = {
  property: {
    select: {
      id: true,
      label: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      pincode: true,
      lat: true,
      lng: true,
      ownerId: true,
      autoApproveEmergency: true,
      tenancies: { where: { status: "ACTIVE" }, select: { tenantId: true } },
    },
  },
  category: { select: { id: true, slug: true, name: true, icon: true } },
  raisedBy: { select: { id: true, name: true, phone: true } },
  payer: { select: { id: true, name: true, phone: true } },
  media: { orderBy: { createdAt: "asc" } },
  job: {
    include: {
      workerProfile: {
        select: { id: true, userId: true, state: true, gstin: true },
      },
    },
  },
} satisfies Prisma.RepairRequestInclude;

export type RequestWithContext = Prisma.RepairRequestGetPayload<{
  include: typeof requestInclude;
}>;

/** Requests a customer can see: raised, paying, owner of the property, or active tenant. */
export const customerVisible = (
  userId: string,
): Prisma.RepairRequestWhereInput => ({
  OR: [
    { raisedById: userId },
    { payerUserId: userId },
    { property: { ownerId: userId } },
    {
      property: { tenancies: { some: { tenantId: userId, status: "ACTIVE" } } },
    },
  ],
});

export type ListFilters = {
  status?: RequestStatus[];
  propertyId?: string;
  scope?: "all" | "raised" | "approvals";
  cursor?: string;
  limit: number;
};

export const requestRepository = {
  countOpenForProperty(propertyId: string, tx: TxClient = prisma) {
    return tx.repairRequest.count({
      where: { propertyId, status: { notIn: TERMINAL_STATUSES } },
    });
  },

  /** Row lock for the duration of the surrounding transaction. */
  async lockById(id: string, tx: TxClient) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM repair_request WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) return null;
    return tx.repairRequest.findUnique({
      where: { id },
      include: requestInclude,
    });
  },

  findWithContext(id: string, tx: TxClient = prisma) {
    return tx.repairRequest.findUnique({
      where: { id },
      include: requestInclude,
    });
  },

  create(
    data: Prisma.RepairRequestUncheckedCreateInput,
    tx: TxClient = prisma,
  ) {
    return tx.repairRequest.create({ data, include: requestInclude });
  },

  update(
    id: string,
    data: Prisma.RepairRequestUncheckedUpdateInput,
    tx: TxClient = prisma,
  ) {
    return tx.repairRequest.update({
      where: { id },
      data,
      include: requestInclude,
    });
  },

  /** Cursor-paginated, scoped in SQL (never fetch-then-filter). `userId=null` = admin (all). */
  async list(userId: string | null, f: ListFilters, tx: TxClient = prisma) {
    const where: Prisma.RepairRequestWhereInput = {
      AND: [
        userId ? customerVisible(userId) : {},
        f.status?.length ? { status: { in: f.status } } : {},
        f.propertyId ? { propertyId: f.propertyId } : {},
        f.scope === "raised" && userId ? { raisedById: userId } : {},
        f.scope === "approvals" && userId
          ? { status: "PENDING_APPROVAL", property: { ownerId: userId } }
          : {},
      ],
    };
    const rows = await tx.repairRequest.findMany({
      where,
      include: requestInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: f.limit + 1,
      ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > f.limit;
    const items = hasMore ? rows.slice(0, f.limit) : rows;
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
  },

  /** Ending a tenancy moves the tenant's open requests to the owner. */
  async transferOpenFromTenant(
    params: { propertyId: string; tenantId: string; ownerId: string },
    tx: TxClient,
  ) {
    const open = await tx.repairRequest.findMany({
      where: {
        propertyId: params.propertyId,
        status: { notIn: TERMINAL_STATUSES },
        OR: [{ raisedById: params.tenantId }, { payerUserId: params.tenantId }],
      },
      select: { id: true, status: true, raisedById: true, payerUserId: true },
    });
    for (const r of open) {
      await tx.repairRequest.update({
        where: { id: r.id },
        data: {
          raisedById:
            r.raisedById === params.tenantId ? params.ownerId : r.raisedById,
          payerUserId:
            r.payerUserId === params.tenantId ? params.ownerId : r.payerUserId,
        },
      });
    }
    return open;
  },

  setQuoteDeadline(id: string, deadline: Date, tx: TxClient = prisma) {
    return tx.repairRequest.update({
      where: { id },
      data: { quoteDeadline: deadline },
    });
  },

  setPayer(id: string, payerUserId: string, tx: TxClient = prisma) {
    return tx.repairRequest.update({ where: { id }, data: { payerUserId } });
  },

  /** Returns true if this call claimed the reminder (idempotent across scheduler runs). */
  async claimReminder(id: string, at: Date, tx: TxClient = prisma) {
    const r = await tx.repairRequest.updateMany({
      where: { id, reminderSentAt: null, status: "PENDING_APPROVAL" },
      data: { reminderSentAt: at },
    });
    return r.count === 1;
  },

  /** Leads = requests this worker was matched to (scoped in SQL). */
  async listLeads(
    workerProfileId: string,
    f: { open?: boolean; cursor?: string; limit: number },
    tx: TxClient = prisma,
  ) {
    const rows = await tx.repairRequest.findMany({
      where: {
        matches: { some: { workerProfileId } },
        ...(f.open ? { status: "OPEN_FOR_QUOTES" } : {}),
      },
      include: {
        ...requestInclude,
        matches: { where: { workerProfileId } },
        quotes: { where: { workerProfileId }, orderBy: { createdAt: "desc" } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: f.limit + 1,
      ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > f.limit;
    const items = hasMore ? rows.slice(0, f.limit) : rows;
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
  },

  findLead(requestId: string, workerProfileId: string, tx: TxClient = prisma) {
    return tx.repairRequest.findFirst({
      where: { id: requestId, matches: { some: { workerProfileId } } },
      include: {
        ...requestInclude,
        matches: { where: { workerProfileId } },
        quotes: { where: { workerProfileId }, orderBy: { createdAt: "desc" } },
      },
    });
  },

  findOpenPastDeadline(now: Date, tx: TxClient = prisma) {
    return tx.repairRequest.findMany({
      where: { status: "OPEN_FOR_QUOTES", quoteDeadline: { lt: now } },
      select: { id: true },
      take: 100,
    });
  },

  findPendingApprovalBefore(cutoff: Date, tx: TxClient = prisma) {
    return tx.repairRequest.findMany({
      where: {
        status: "PENDING_APPROVAL",
        createdAt: { lt: cutoff },
        reminderSentAt: null,
      },
      include: requestInclude,
      take: 100,
    });
  },

  countMediaByKind(
    requestId: string,
    kind: "BEFORE" | "AFTER" | "DOCUMENT",
    tx: TxClient = prisma,
  ) {
    return tx.requestMedia.count({ where: { requestId, kind } });
  },

  addMedia(
    data: Prisma.RequestMediaUncheckedCreateInput[],
    tx: TxClient = prisma,
  ) {
    return tx.requestMedia.createManyAndReturn({ data });
  },

  findMedia(requestId: string, mediaId: string, tx: TxClient = prisma) {
    return tx.requestMedia.findFirst({ where: { id: mediaId, requestId } });
  },
};

export const requestEventRepository = {
  append(
    data: {
      requestId: string;
      actorId: string | null;
      action: string;
      fromStatus: RequestStatus | null;
      toStatus: RequestStatus;
      payload?: Prisma.InputJsonValue;
    },
    tx: TxClient = prisma,
  ) {
    return tx.requestEvent.create({
      data: { ...data, payload: data.payload ?? {} },
    });
  },

  listForRequest(requestId: string, tx: TxClient = prisma) {
    return tx.requestEvent.findMany({
      where: { requestId },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  },
};

export type PriorityT = Priority;
