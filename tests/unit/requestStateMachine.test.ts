import { describe, expect, it } from "vitest";
import {
  availableActions,
  REQUEST_STATUSES,
  TRANSITIONS,
  transition,
  TransitionError,
  type Relation,
  type RequestAction,
} from "../../src/domain/requestStateMachine.js";

const ALL_ACTIONS = [
  ...new Set(TRANSITIONS.map((t) => t.action)),
] as RequestAction[];
const ALL_RELATIONS: Relation[] = [
  "OWNER",
  "TENANT",
  "PAYER",
  "RAISER",
  "WORKER",
  "ADMIN",
  "SYSTEM",
];

const legal: Array<[string, RequestAction, string, Relation, object?]> = [
  ["PENDING_APPROVAL", "approve", "OPEN_FOR_QUOTES", "OWNER"],
  ["PENDING_APPROVAL", "reject", "REJECTED", "OWNER"],
  ["PENDING_APPROVAL", "cancel", "CANCELLED", "RAISER"],
  ["OPEN_FOR_QUOTES", "cancel", "CANCELLED", "PAYER"],
  ["SCHEDULED", "cancel", "CANCELLED", "RAISER"],
  ["OPEN_FOR_QUOTES", "expire", "EXPIRED", "SYSTEM", { submittedQuotes: 0 }],
  ["EXPIRED", "reopen", "OPEN_FOR_QUOTES", "RAISER", { reopenedCount: 0 }],
  ["OPEN_FOR_QUOTES", "accept_quote", "SCHEDULED", "PAYER"],
  ["SCHEDULED", "start", "IN_PROGRESS", "WORKER", { jobSubStatus: "ARRIVED" }],
  ["IN_PROGRESS", "complete", "PENDING_SIGN_OFF", "WORKER"],
  ["PENDING_SIGN_OFF", "confirm", "COMPLETED", "TENANT"],
  ["PENDING_SIGN_OFF", "auto_confirm", "COMPLETED", "SYSTEM"],
  ["PENDING_SIGN_OFF", "dispute", "DISPUTED", "OWNER"],
  ["DISPUTED", "resolve_complete", "COMPLETED", "ADMIN"],
  ["DISPUTED", "resolve_cancel", "CANCELLED", "ADMIN"],
];

describe("request state machine", () => {
  it.each(legal)("%s --%s--> %s by %s", (from, action, to, actor, ctx) => {
    expect(transition(from as never, action, [actor], ctx ?? {})).toBe(to);
  });

  it("every (status, action) pair not in the table is INVALID_TRANSITION", () => {
    let checked = 0;
    for (const status of REQUEST_STATUSES) {
      for (const action of ALL_ACTIONS) {
        const exists = TRANSITIONS.some(
          (t) => t.action === action && t.from.includes(status),
        );
        if (exists) continue;
        checked++;
        try {
          transition(status, action, ALL_RELATIONS, {
            submittedQuotes: 0,
            jobSubStatus: "ARRIVED",
          });
          throw new Error(`expected failure for ${status}/${action}`);
        } catch (e) {
          expect(e).toBeInstanceOf(TransitionError);
          expect((e as TransitionError).kind).toBe("INVALID_TRANSITION");
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("wrong actor is FORBIDDEN", () => {
    expect(() =>
      transition("PENDING_APPROVAL", "approve", ["TENANT", "RAISER"]),
    ).toThrow(expect.objectContaining({ kind: "FORBIDDEN" }));
    expect(() =>
      transition("OPEN_FOR_QUOTES", "accept_quote", ["OWNER"]),
    ).toThrow(expect.objectContaining({ kind: "FORBIDDEN" }));
    expect(() => transition("OPEN_FOR_QUOTES", "expire", ["ADMIN"])).toThrow(
      expect.objectContaining({ kind: "FORBIDDEN" }),
    );
  });

  it("guards: reopen once, expire only without quotes, start only after arrival", () => {
    expect(() =>
      transition("EXPIRED", "reopen", ["RAISER"], { reopenedCount: 1 }),
    ).toThrow(expect.objectContaining({ code: "ALREADY_REOPENED" }));
    expect(() =>
      transition("OPEN_FOR_QUOTES", "expire", ["SYSTEM"], {
        submittedQuotes: 2,
      }),
    ).toThrow(expect.objectContaining({ code: "HAS_QUOTES" }));
    expect(() =>
      transition("SCHEDULED", "start", ["WORKER"], {
        jobSubStatus: "EN_ROUTE",
      }),
    ).toThrow(expect.objectContaining({ code: "MUST_ARRIVE_FIRST" }));
  });

  it("availableActions lists what the caller can do now", () => {
    expect(availableActions("PENDING_APPROVAL", ["OWNER"])).toEqual([
      "approve",
      "reject",
    ]);
    expect(availableActions("PENDING_APPROVAL", ["TENANT", "RAISER"])).toEqual([
      "cancel",
    ]);
    expect(
      availableActions("EXPIRED", ["RAISER"], { reopenedCount: 1 }),
    ).toEqual([]);
    expect(availableActions("OPEN_FOR_QUOTES", ["SYSTEM"])).toEqual([]);
  });
});
