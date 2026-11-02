/**
 * Repair request state machine (requirements.md §4.4, system-design.md §4). Pure — no I/O.
 * Every status change goes through `transition()`; the service layer wraps it in a locked transaction.
 */

export const REQUEST_STATUSES = [
  "AWAITING_OWNER_JOIN",
  "PENDING_APPROVAL",
  "OPEN_FOR_QUOTES",
  "SCHEDULED",
  "IN_PROGRESS",
  "PENDING_SIGN_OFF",
  "COMPLETED",
  "DISPUTED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Relations of the acting user to a specific request (contextual, never stored as roles). */
export type Relation =
  "OWNER" | "TENANT" | "PAYER" | "RAISER" | "WORKER" | "ADMIN" | "SYSTEM";

export type RequestAction =
  | "approve"
  | "reject"
  | "cancel"
  | "expire"
  | "reopen"
  | "accept_quote"
  | "start"
  | "complete"
  | "confirm"
  | "auto_confirm"
  | "dispute"
  | "resolve_complete"
  | "resolve_cancel";

export type GuardCtx = {
  reopenedCount?: number;
  submittedQuotes?: number;
  jobSubStatus?: string | null;
};

export type Transition = {
  action: RequestAction;
  from: readonly RequestStatus[];
  to: RequestStatus;
  actors: readonly Relation[];
  /** Returns an error code when the transition is not allowed in this context. */
  guard?: (ctx: GuardCtx) => string | null;
};

const CUSTOMER_SIDE: Relation[] = ["OWNER", "TENANT", "RAISER", "PAYER"];

export const TRANSITIONS: readonly Transition[] = [
  {
    action: "approve",
    from: ["PENDING_APPROVAL"],
    to: "OPEN_FOR_QUOTES",
    actors: ["OWNER"],
  },
  {
    action: "reject",
    from: ["PENDING_APPROVAL"],
    to: "REJECTED",
    actors: ["OWNER"],
  },
  {
    action: "cancel",
    from: ["PENDING_APPROVAL", "OPEN_FOR_QUOTES", "SCHEDULED"],
    to: "CANCELLED",
    actors: ["RAISER", "PAYER"],
  },
  {
    action: "expire",
    from: ["OPEN_FOR_QUOTES"],
    to: "EXPIRED",
    actors: ["SYSTEM"],
    guard: (c) => ((c.submittedQuotes ?? 0) > 0 ? "HAS_QUOTES" : null),
  },
  {
    action: "reopen",
    from: ["EXPIRED"],
    to: "OPEN_FOR_QUOTES",
    actors: ["RAISER", "PAYER"],
    guard: (c) => ((c.reopenedCount ?? 0) >= 1 ? "ALREADY_REOPENED" : null),
  },
  {
    action: "accept_quote",
    from: ["OPEN_FOR_QUOTES"],
    to: "SCHEDULED",
    actors: ["PAYER"],
  },
  {
    action: "start",
    from: ["SCHEDULED"],
    to: "IN_PROGRESS",
    actors: ["WORKER"],
    guard: (c) => (c.jobSubStatus === "ARRIVED" ? null : "MUST_ARRIVE_FIRST"),
  },
  {
    action: "complete",
    from: ["IN_PROGRESS"],
    to: "PENDING_SIGN_OFF",
    actors: ["WORKER"],
  },
  {
    action: "confirm",
    from: ["PENDING_SIGN_OFF"],
    to: "COMPLETED",
    actors: CUSTOMER_SIDE,
  },
  {
    action: "auto_confirm",
    from: ["PENDING_SIGN_OFF"],
    to: "COMPLETED",
    actors: ["SYSTEM"],
  },
  {
    action: "dispute",
    from: ["PENDING_SIGN_OFF"],
    to: "DISPUTED",
    actors: CUSTOMER_SIDE,
  },
  {
    action: "resolve_complete",
    from: ["DISPUTED"],
    to: "COMPLETED",
    actors: ["ADMIN"],
  },
  {
    action: "resolve_cancel",
    from: ["DISPUTED"],
    to: "CANCELLED",
    actors: ["ADMIN"],
  },
];

export class TransitionError extends Error {
  constructor(
    readonly kind: "INVALID_TRANSITION" | "FORBIDDEN" | "GUARD",
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TransitionError";
  }
}

export function findTransition(
  status: RequestStatus,
  action: RequestAction,
): Transition | undefined {
  return TRANSITIONS.find(
    (t) => t.action === action && t.from.includes(status),
  );
}

/**
 * Validates a transition and returns the target status.
 * Throws TransitionError: INVALID_TRANSITION (wrong state), FORBIDDEN (wrong actor), GUARD (context).
 */
export function transition(
  status: RequestStatus,
  action: RequestAction,
  relations: readonly Relation[],
  ctx: GuardCtx = {},
): RequestStatus {
  const t = findTransition(status, action);
  if (!t) {
    throw new TransitionError(
      "INVALID_TRANSITION",
      "INVALID_TRANSITION",
      `Cannot ${action.replace("_", " ")} a request that is ${status}`,
    );
  }
  if (!t.actors.some((a) => relations.includes(a))) {
    throw new TransitionError(
      "FORBIDDEN",
      "FORBIDDEN",
      `You are not allowed to ${action.replace("_", " ")} this request`,
    );
  }
  const guardCode = t.guard?.(ctx);
  if (guardCode)
    throw new TransitionError(
      "GUARD",
      guardCode,
      `Not allowed now: ${guardCode}`,
    );
  return t.to;
}

/** Actions the caller could perform right now (guards evaluated) — drives the UI buttons. */
export function availableActions(
  status: RequestStatus,
  relations: readonly Relation[],
  ctx: GuardCtx = {},
): RequestAction[] {
  return TRANSITIONS.filter(
    (t) =>
      t.from.includes(status) &&
      t.actors.some((a) => a !== "SYSTEM" && relations.includes(a)) &&
      !t.guard?.(ctx),
  ).map((t) => t.action);
}

export const TERMINAL: readonly RequestStatus[] = [
  "COMPLETED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
];
