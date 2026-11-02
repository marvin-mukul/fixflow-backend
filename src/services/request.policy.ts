import type { Relation } from "../domain/requestStateMachine.js";
import { AppError } from "../errors/AppError.js";
import type { GlobalRole } from "../generated/prisma/enums.js";
import type { RequestWithContext } from "../repositories/request.repository.js";

export type Viewer = { id: string; globalRole: GlobalRole };

/** Contextual relations of a user to a request (requirements.md §3.2). */
export function relationsFor(
  req: RequestWithContext,
  user: Viewer,
): Relation[] {
  const r: Relation[] = [];
  if (req.property.ownerId === user.id) r.push("OWNER");
  if (req.property.tenancies.some((t) => t.tenantId === user.id))
    r.push("TENANT");
  if (req.payerUserId === user.id) r.push("PAYER");
  if (req.raisedById === user.id) r.push("RAISER");
  if (req.job?.workerProfile.userId === user.id) r.push("WORKER");
  if (user.globalRole === "ADMIN" || user.globalRole === "SUPERADMIN")
    r.push("ADMIN");
  return r;
}

export const requestPolicy = {
  /** Visible = any relation. Invisible → 404 so existence never leaks. */
  assertVisible(req: RequestWithContext | null, user: Viewer): Relation[] {
    if (!req) throw AppError.notFound("Request not found");
    const rel = relationsFor(req, user);
    if (rel.length === 0) throw AppError.notFound("Request not found");
    return rel;
  },

  /** Customer-side participant (owner, active tenant, raiser, payer). */
  isCustomerSide(rel: Relation[]) {
    return rel.some(
      (r) => r === "OWNER" || r === "TENANT" || r === "RAISER" || r === "PAYER",
    );
  },
};
