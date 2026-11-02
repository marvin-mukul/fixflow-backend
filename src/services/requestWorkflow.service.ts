import {
  transition,
  TransitionError,
  type GuardCtx,
  type Relation,
  type RequestAction,
  type RequestStatus,
} from "../domain/requestStateMachine.js";
import { AppError } from "../errors/AppError.js";
import type { Prisma } from "../generated/prisma/client.js";
import { logger } from "../lib/logger.js";
import { prisma, type TxClient } from "../lib/prisma.js";
import type { NewNotification } from "../repositories/notification.repository.js";
import {
  requestEventRepository,
  requestRepository,
  type RequestWithContext,
} from "../repositories/request.repository.js";
import {
  notificationService,
  type AfterCommit,
} from "./notification.service.js";
import { relationsFor, type Viewer } from "./request.policy.js";

export type Actor = Viewer | "SYSTEM";

type EnterHook = (
  tx: TxClient,
  req: RequestWithContext,
  afterCommit: AfterCommit,
) => Promise<void>;
const enterHooks = new Map<RequestStatus, EnterHook[]>();

/** Registers side effects that run whenever a request enters `status` (inside the transaction). */
export function onEnterStatus(status: RequestStatus, hook: EnterHook) {
  enterHooks.set(status, [...(enterHooks.get(status) ?? []), hook]);
}

export async function runEnterHooks(
  tx: TxClient,
  req: RequestWithContext,
  afterCommit: AfterCommit,
) {
  for (const hook of enterHooks.get(req.status) ?? [])
    await hook(tx, req, afterCommit);
}

export async function runAfterCommit(afterCommit: AfterCommit) {
  for (const fn of afterCommit) {
    try {
      await fn();
    } catch (err) {
      logger.error({ err }, "after-commit task failed");
    }
  }
}

export function toAppError(e: unknown): unknown {
  if (!(e instanceof TransitionError)) return e;
  if (e.kind === "FORBIDDEN") return AppError.forbidden(e.message);
  if (e.kind === "INVALID_TRANSITION")
    return AppError.invalidTransition(e.message);
  return AppError.conflict(e.code, e.message);
}

export type TransitionOptions = {
  /** Extra context for guards (quote counts, job sub-status...). */
  guardCtx?: (tx: TxClient, req: RequestWithContext) => Promise<GuardCtx>;
  /** Runs after validation, before the status update (create job, reject siblings...). */
  sideEffects?: (
    tx: TxClient,
    req: RequestWithContext,
    afterCommit: AfterCommit,
  ) => Promise<void>;
  /** Extra columns to set together with the new status. */
  data?: Prisma.RepairRequestUncheckedUpdateInput;
  payload?: Prisma.InputJsonValue;
  notify?: (req: RequestWithContext) => {
    rows: NewNotification[];
    email?: boolean;
  };
};

/**
 * The single path for request status changes (system-design.md §4): lock row → resolve relations →
 * state machine → side effects → status update → RequestEvent → enter hooks → notifications,
 * all in one transaction; emails after commit.
 */
export async function applyTransition(
  requestId: string,
  action: RequestAction,
  actor: Actor,
  opts: TransitionOptions = {},
): Promise<RequestWithContext> {
  const afterCommit: AfterCommit = [];
  const result = await prisma
    .$transaction(async (tx) => {
      const req = await requestRepository.lockById(requestId, tx);
      if (!req) throw AppError.notFound("Request not found");
      const relations: Relation[] =
        actor === "SYSTEM" ? ["SYSTEM"] : relationsFor(req, actor);
      if (relations.length === 0) throw AppError.notFound("Request not found");

      const ctx = opts.guardCtx ? await opts.guardCtx(tx, req) : {};
      const to = transition(req.status, action, relations, ctx);

      await opts.sideEffects?.(tx, req, afterCommit);
      const updated = await requestRepository.update(
        req.id,
        { ...opts.data, status: to },
        tx,
      );
      await requestEventRepository.append(
        {
          requestId: req.id,
          actorId: actor === "SYSTEM" ? null : actor.id,
          action,
          fromStatus: req.status,
          toStatus: to,
          payload: opts.payload,
        },
        tx,
      );
      await runEnterHooks(tx, updated, afterCommit);
      if (opts.notify) {
        const n = opts.notify(updated);
        const actorId = actor === "SYSTEM" ? null : actor.id;
        await notificationService.notify(
          tx,
          n.rows.filter((r) => r.userId !== actorId),
          afterCommit,
          n.email,
        );
      }
      // Re-read so enter hooks' changes (deadline, matches) are reflected.
      return (await requestRepository.findWithContext(req.id, tx))!;
    })
    .catch((e: unknown) => {
      throw toAppError(e);
    });
  await runAfterCommit(afterCommit);
  return result;
}
