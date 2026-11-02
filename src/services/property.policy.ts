import { AppError } from "../errors/AppError.js";
import {
  propertyRepository,
  type PropertyRow,
} from "../repositories/property.repository.js";
import type { TxClient } from "../lib/prisma.js";

export type PropertyRelation = "OWNER" | "TENANT";

export function relationOf(
  p: PropertyRow,
  userId: string,
): PropertyRelation | null {
  if (p.ownerId === userId) return "OWNER";
  if (p.tenancies.some((t) => t.tenantId === userId)) return "TENANT";
  return null;
}

export const propertyPolicy = {
  /** Owner or active tenant; anything else is a 404 (never leak existence). */
  async assertOwnerOrTenant(propertyId: string, userId: string, tx?: TxClient) {
    const p = await propertyRepository.findVisible(propertyId, userId, tx);
    if (!p) throw AppError.notFound("Property not found");
    return { property: p, relation: relationOf(p, userId)! };
  },

  /** Owner only. Tenants get 403 (they can see it), strangers 404. */
  async assertOwner(propertyId: string, userId: string, tx?: TxClient) {
    const { property, relation } = await this.assertOwnerOrTenant(
      propertyId,
      userId,
      tx,
    );
    if (relation !== "OWNER")
      throw AppError.forbidden("Only the owner can do this");
    return property;
  },
};
