/** Job sub-status while the request is SCHEDULED / IN_PROGRESS (requirements.md §4.4). Pure. */
export type JobSubStatus =
  "CONFIRMED" | "EN_ROUTE" | "ARRIVED" | "WORKING" | "DONE";
export type JobAction = "en_route" | "arrive" | "start" | "complete";

const NEXT: Record<JobAction, { from: JobSubStatus; to: JobSubStatus }> = {
  en_route: { from: "CONFIRMED", to: "EN_ROUTE" },
  arrive: { from: "EN_ROUTE", to: "ARRIVED" },
  start: { from: "ARRIVED", to: "WORKING" },
  complete: { from: "WORKING", to: "DONE" },
};

/** Returns the next sub-status, or null when the order is violated. */
export function nextSubStatus(
  current: JobSubStatus,
  action: JobAction,
): JobSubStatus | null {
  const t = NEXT[action];
  return t.from === current ? t.to : null;
}

export function workerActions(current: JobSubStatus): JobAction[] {
  return (Object.keys(NEXT) as JobAction[]).filter(
    (a) => NEXT[a].from === current,
  );
}
