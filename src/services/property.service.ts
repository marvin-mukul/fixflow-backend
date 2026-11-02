import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { sendMail } from "../lib/mailer.js";
import { prisma, type TxClient } from "../lib/prisma.js";
import { invitationRepository } from "../repositories/invitation.repository.js";
import { requestRepository } from "../repositories/request.repository.js";
import {
  propertyRepository,
  type PropertyRow,
} from "../repositories/property.repository.js";
import { tenancyRepository } from "../repositories/tenancy.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import type {
  InviteInput,
  PropertyInput,
  PropertyPatch,
} from "../schemas/property.schema.js";
import {
  propertyPolicy,
  relationOf,
  type PropertyRelation,
} from "./property.policy.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type TenancyEndedHook = (
  tx: TxClient,
  ctx: {
    propertyId: string;
    tenantId: string;
    ownerId: string | null;
    actorId: string;
  },
) => Promise<void>;

const tenancyEndedHooks: TenancyEndedHook[] = [];

/** Other services (requests) register here, so property.service doesn't depend on them. */
export function onTenancyEnded(hook: TenancyEndedHook) {
  tenancyEndedHooks.push(hook);
}

export function toPropertyDto(p: PropertyRow, relation: PropertyRelation) {
  return {
    id: p.id,
    ownerId: p.ownerId,
    label: p.label,
    type: p.type,
    addressLine1: p.addressLine1,
    addressLine2: p.addressLine2,
    city: p.city,
    state: p.state,
    pincode: p.pincode,
    lat: p.lat,
    lng: p.lng,
    isOwnerOccupied: p.isOwnerOccupied,
    autoApproveEmergency: p.autoApproveEmergency,
    relation,
    ownerName: p.owner?.name ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

export const propertyService = {
  async list(userId: string) {
    const rows = await propertyRepository.listVisible(userId);
    return { items: rows.map((p) => toPropertyDto(p, relationOf(p, userId)!)) };
  },

  async get(id: string, userId: string) {
    const { property, relation } = await propertyPolicy.assertOwnerOrTenant(
      id,
      userId,
    );
    const [tenancies, invitations] = await Promise.all([
      tenancyRepository.listForProperty(id),
      relation === "OWNER"
        ? invitationRepository.listPendingForProperty(id)
        : Promise.resolve([]),
    ]);
    const visibleTenancies =
      relation === "OWNER"
        ? tenancies
        : tenancies.filter((t) => t.tenantId === userId);
    return {
      ...toPropertyDto(property, relation),
      tenants: visibleTenancies.map((t) => ({
        tenancyId: t.id,
        userId: t.tenant.id,
        name: t.tenant.name,
        email: t.tenant.email,
        status: t.status,
        startDate: t.startDate.toISOString(),
        endDate: t.endDate?.toISOString() ?? null,
      })),
      pendingInvitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        expiresAt: i.expiresAt.toISOString(),
      })),
    };
  },

  async create(userId: string, input: PropertyInput) {
    const p = await propertyRepository.create({
      ...input,
      addressLine2: input.addressLine2 ?? null,
      ownerId: userId,
    });
    return toPropertyDto(p, "OWNER");
  },

  async update(id: string, userId: string, input: PropertyPatch) {
    await propertyPolicy.assertOwner(id, userId);
    const p = await propertyRepository.update(id, input);
    return toPropertyDto(p, "OWNER");
  },

  async remove(id: string, userId: string) {
    await propertyPolicy.assertOwner(id, userId);
    const openRequests = await requestRepository.countOpenForProperty(id);
    if (openRequests > 0)
      throw AppError.conflict(
        "PROPERTY_HAS_OPEN_REQUESTS",
        "Close or cancel open requests first",
      );
    await propertyRepository.softDelete(id);
  },

  async invite(propertyId: string, userId: string, input: InviteInput) {
    const property = await propertyPolicy.assertOwner(propertyId, userId);
    const inviter = await userRepository.findById(userId);
    if (inviter?.email === input.email)
      throw AppError.validation([
        { path: "email", message: "You cannot invite yourself" },
      ]);
    const existing = await userRepository.findByEmail(input.email);
    if (
      existing &&
      (await tenancyRepository.findActive(propertyId, existing.id))
    )
      throw AppError.conflict(
        "ALREADY_TENANT",
        "This person is already a tenant here",
      );

    const token = randomToken(32);
    const inv = await invitationRepository.create({
      type: "TENANT",
      propertyId,
      inviterId: userId,
      email: input.email,
      phone: input.phone ?? null,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
    const link = `${env.APP_URL}/invitations/${token}`;
    await sendMail({
      to: input.email,
      subject: `${inviter?.name ?? "Your landlord"} invited you to ${property.label} on FixFlow`,
      text: `You've been invited as a tenant of ${property.label} (${property.city}).\n\nAccept the invitation: ${link}\n\nThis link expires in 7 days and can be used once.`,
    });
    return {
      id: inv.id,
      email: inv.email,
      expiresAt: inv.expiresAt.toISOString(),
    };
  },

  async loadInvitation(token: string) {
    const inv = await invitationRepository.findByTokenHash(sha256(token));
    if (!inv || inv.property.deletedAt)
      throw AppError.notFound("Invitation not found");
    if (inv.acceptedAt)
      throw AppError.conflict(
        "INVITATION_USED",
        "This invitation was already used",
      );
    if (inv.expiresAt.getTime() <= Date.now())
      throw new AppError(
        410,
        "INVITATION_EXPIRED",
        "This invitation has expired",
      );
    return inv;
  },

  async previewInvitation(token: string) {
    const inv = await this.loadInvitation(token);
    const user = await userRepository.findByEmail(inv.email);
    return {
      type: inv.type,
      email: inv.email,
      propertyLabel: inv.property.label,
      city: inv.property.city,
      inviterName: inv.inviter.name,
      expiresAt: inv.expiresAt.toISOString(),
      needsRegistration: !user,
    };
  },

  async acceptInvitation(token: string, user: Express.User) {
    const inv = await this.loadInvitation(token);
    if (inv.email !== user.email.toLowerCase())
      throw new AppError(
        403,
        "INVITATION_EMAIL_MISMATCH",
        "This invitation was sent to a different email",
      );
    if (user.globalRole !== "CUSTOMER")
      throw AppError.forbidden("Only customer accounts can become tenants");
    return prisma.$transaction(async (tx) => {
      if (!(await invitationRepository.markAccepted(inv.id, tx)))
        throw AppError.conflict(
          "INVITATION_USED",
          "This invitation was already used",
        );
      const already = await tenancyRepository.findActive(
        inv.propertyId,
        user.id,
        tx,
      );
      const tenancy =
        already ??
        (await tenancyRepository.createActive(inv.propertyId, user.id, tx));
      return { propertyId: inv.propertyId, tenancyId: tenancy.id };
    });
  },

  async endTenancy(propertyId: string, tenancyId: string, userId: string) {
    const { property, relation } = await propertyPolicy.assertOwnerOrTenant(
      propertyId,
      userId,
    );
    const tenancy = await tenancyRepository.findById(tenancyId);
    if (!tenancy || tenancy.propertyId !== propertyId)
      throw AppError.notFound("Tenancy not found");
    if (relation === "TENANT" && tenancy.tenantId !== userId)
      throw AppError.notFound("Tenancy not found");
    if (tenancy.status !== "ACTIVE")
      throw AppError.conflict(
        "TENANCY_NOT_ACTIVE",
        "This tenancy is not active",
      );
    await prisma.$transaction(async (tx) => {
      await tenancyRepository.end(tenancyId, tx);
      for (const hook of tenancyEndedHooks) {
        await hook(tx, {
          propertyId,
          tenantId: tenancy.tenantId,
          ownerId: property.ownerId,
          actorId: userId,
        });
      }
    });
  },
};
