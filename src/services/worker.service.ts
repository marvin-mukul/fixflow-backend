import { approxDistanceKm, maskLocation } from "../domain/geo.js";
import { bayesianScore } from "../domain/ranking.js";
import { AppError } from "../errors/AppError.js";
import { prisma } from "../lib/prisma.js";
import { categoryRepository } from "../repositories/category.repository.js";
import {
  requestRepository,
  type RequestWithContext,
} from "../repositories/request.repository.js";
import {
  matchRepository,
  workerRepository,
  type WorkerWithContext,
} from "../repositories/worker.repository.js";
import type { WorkerProfileInput } from "../schemas/worker.schema.js";
import { DOCUMENT_TYPES, verifyAndStore } from "./media.service.js";
import { settingsService } from "./settings.service.js";

type QuoteRow = {
  id: string;
  status: "SUBMITTED" | "WITHDRAWN" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  version: number;
  labourPaise: number;
  materialsPaise: number;
  etaHours: number;
  proposedSlot: Date | null;
  validUntil: Date;
  notes: string | null;
};
type LeadRow = RequestWithContext & {
  matches: { distanceKm: number; notifiedAt: Date }[];
  quotes: QuoteRow[];
};

export function toQuoteSummary(q: QuoteRow) {
  return {
    id: q.id,
    status: q.status,
    version: q.version,
    labourPaise: q.labourPaise,
    materialsPaise: q.materialsPaise,
    totalPaise: q.labourPaise + q.materialsPaise,
    etaHours: q.etaHours,
    proposedSlot: q.proposedSlot?.toISOString() ?? null,
    validUntil: q.validUntil.toISOString(),
    notes: q.notes,
  };
}

export function toProfileDto(w: WorkerWithContext) {
  return {
    id: w.id,
    userId: w.userId,
    name: w.user.name,
    bio: w.bio,
    baseLat: w.baseLat,
    baseLng: w.baseLng,
    serviceRadiusKm: w.serviceRadiusKm,
    isAvailable: w.isAvailable,
    verificationStatus: w.verificationStatus,
    hasIdDocument: Boolean(w.idDocumentPath),
    gstin: w.gstin,
    state: w.state,
    categories: w.categories.map((c) => ({
      ...c.category,
      yearsExperience: c.yearsExperience,
    })),
    verifiedAt: w.verifiedAt?.toISOString() ?? null,
  };
}

/** Aggregates per-category WorkerStats into one rating breakdown. */
export function ratingBreakdown(
  stats: WorkerWithContext["stats"],
  C: number,
  m: number,
) {
  const sum = (k: keyof (typeof stats)[number]) =>
    stats.reduce((a, s) => a + Number(s[k] ?? 0), 0);
  const avg = (total: number, n: number) =>
    n > 0 ? Math.round((total / n) * 100) / 100 : null;
  const n = sum("ratingCount");
  return {
    count: n,
    bayesian: Math.round(bayesianScore(sum("sumOverall"), n, C, m) * 100) / 100,
    overall: avg(sum("sumOverall"), n),
    quality: avg(sum("sumQuality"), sum("countQuality")),
    punctuality: avg(sum("sumPunctuality"), sum("countPunctuality")),
    behaviour: avg(sum("sumBehaviour"), sum("countBehaviour")),
    value: avg(sum("sumValue"), sum("countValue")),
  };
}

/** Lead view: masked (locality, ~1 km coords, no address/phone) until this worker's quote is accepted. */
export function toLeadDto(r: LeadRow, workerProfileId: string) {
  const match = r.matches[0]!;
  const unmasked = r.job?.workerProfileId === workerProfileId;
  const active =
    r.quotes.find((q) => q.status === "SUBMITTED" || q.status === "ACCEPTED") ??
    r.quotes[0] ??
    null;
  const slots = Array.isArray(r.preferredSlots)
    ? (r.preferredSlots as { start: string; end: string }[])
    : [];
  const open =
    r.status === "OPEN_FOR_QUOTES" &&
    (!r.quoteDeadline || r.quoteDeadline.getTime() > Date.now());
  return {
    requestId: r.id,
    title: r.title,
    description: r.description,
    priority: r.priority,
    status: r.status,
    category: r.category,
    locality: { city: r.property.city, pincode: r.property.pincode },
    approxDistanceKm: approxDistanceKm(match.distanceKm),
    location: unmasked
      ? { lat: r.property.lat, lng: r.property.lng }
      : maskLocation(r.property),
    preferredSlots: slots,
    quoteDeadline: r.quoteDeadline?.toISOString() ?? null,
    media: r.media
      .filter((m) => m.kind === "BEFORE")
      .map((m) => ({
        id: m.id,
        url: `/api/v1/requests/${r.id}/media/${m.id}`,
        mimeType: m.mimeType,
      })),
    myQuote: active ? toQuoteSummary(active) : null,
    canQuote:
      open &&
      !r.quotes.some(
        (q) => q.status === "SUBMITTED" || q.status === "ACCEPTED",
      ),
    unmasked,
    address: unmasked
      ? {
          addressLine1: r.property.addressLine1,
          addressLine2: r.property.addressLine2,
          city: r.property.city,
          state: r.property.state,
          pincode: r.property.pincode,
        }
      : null,
    contact: unmasked
      ? { name: r.raisedBy.name, phone: r.raisedBy.phone }
      : null,
    jobId: unmasked ? r.job!.id : null,
    matchedAt: match.notifiedAt.toISOString(),
  };
}

export const workerService = {
  async requireProfile(userId: string) {
    const w = await workerRepository.findByUserId(userId);
    if (!w)
      throw new AppError(
        404,
        "WORKER_PROFILE_MISSING",
        "Complete your worker profile first",
      );
    return w;
  },

  async getProfile(userId: string) {
    return toProfileDto(await this.requireProfile(userId));
  },

  async upsertProfile(userId: string, input: WorkerProfileInput) {
    const existing = await workerRepository.findByUserId(userId);
    const w = await workerRepository.upsertProfile(userId, {
      bio: input.bio,
      baseLat: input.baseLat,
      baseLng: input.baseLng,
      serviceRadiusKm: input.serviceRadiusKm,
      state: input.state,
      gstin: input.gstin ?? null,
      // Editing a rejected profile sends it back to the queue.
      ...(existing?.verificationStatus === "REJECTED"
        ? { verificationStatus: "PENDING" as const }
        : {}),
    });
    return toProfileDto(w);
  },

  async setCategories(
    userId: string,
    rows: { categoryId: string; yearsExperience: number }[],
  ) {
    const w = await this.requireProfile(userId);
    const ids = [...new Set(rows.map((r) => r.categoryId))];
    for (const id of ids) {
      const c = await categoryRepository.findById(id);
      if (!c || !c.isActive)
        throw AppError.validation([
          { path: "categories", message: `Unknown category ${id}` },
        ]);
    }
    const unique = ids.map((id) => rows.find((r) => r.categoryId === id)!);
    await prisma.$transaction((tx) =>
      workerRepository.replaceCategories(w.id, unique, tx),
    );
    return this.getProfile(userId);
  },

  async setAvailability(userId: string, isAvailable: boolean) {
    const w = await this.requireProfile(userId);
    return toProfileDto(await workerRepository.update(w.id, { isAvailable }));
  },

  async uploadIdDocument(userId: string, files: Express.Multer.File[]) {
    const w = await this.requireProfile(userId);
    const [stored] = await verifyAndStore(
      files.slice(0, 1),
      DOCUMENT_TYPES,
      "id-documents",
    );
    const updated = await workerRepository.update(w.id, {
      idDocumentPath: stored!.path,
      ...(w.verificationStatus === "REJECTED"
        ? { verificationStatus: "PENDING" }
        : {}),
    });
    return toProfileDto(updated);
  },

  async publicProfile(workerProfileId: string) {
    const w = await workerRepository.findById(workerProfileId);
    if (!w || w.verificationStatus !== "VERIFIED" || w.user.status !== "ACTIVE")
      throw AppError.notFound("Worker not found");
    const s = await settingsService.getSettings();
    return {
      id: w.id,
      name: w.user.name,
      bio: w.bio,
      state: w.state,
      verified: true,
      categories: w.categories.map((c) => ({
        ...c.category,
        yearsExperience: c.yearsExperience,
      })),
      jobsCompleted: w.stats.reduce((a, st) => a + st.jobsCompleted, 0),
      rating: ratingBreakdown(w.stats, s.bayesianC, s.bayesianPriorMean),
      memberSince: w.createdAt.toISOString(),
    };
  },

  async leads(
    userId: string,
    q: { open: boolean; cursor?: string; limit: number },
  ) {
    const w = await this.requireProfile(userId);
    const page = await requestRepository.listLeads(w.id, q);
    return {
      items: page.items.map((r) => toLeadDto(r as LeadRow, w.id)),
      nextCursor: page.nextCursor,
    };
  },

  async lead(userId: string, requestId: string) {
    const w = await this.requireProfile(userId);
    const r = await requestRepository.findLead(requestId, w.id);
    if (!r) throw AppError.notFound("Lead not found");
    await matchRepository.markViewed(requestId, w.id);
    return toLeadDto(r as LeadRow, w.id);
  },
};
