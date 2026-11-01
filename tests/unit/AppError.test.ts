import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { AppError } from "../../src/errors/AppError.js";
import { toAppError } from "../../src/middlewares/errorHandler.js";

describe("AppError", () => {
  it("factories set status and code", () => {
    expect(AppError.notFound()).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    expect(AppError.forbidden()).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect(AppError.unauthenticated()).toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    expect(AppError.invalidTransition()).toMatchObject({
      status: 409,
      code: "INVALID_TRANSITION",
    });
    expect(AppError.rateLimited()).toMatchObject({ status: 429 });
  });

  it("is an Error", () => {
    expect(AppError.internal()).toBeInstanceOf(Error);
  });
});

describe("toAppError", () => {
  it("maps ZodError to 422 with details", () => {
    const r = z.object({ email: z.string().email() }).safeParse({ email: "x" });
    const err = toAppError(r.error as ZodError);
    expect(err.status).toBe(422);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details[0]?.path).toBe("email");
  });

  it("maps Prisma P2002 to 409 and P2025 to 404", () => {
    const p = (code: string) =>
      Object.assign(new Error("x"), {
        name: "PrismaClientKnownRequestError",
        code,
      });
    expect(toAppError(p("P2002")).status).toBe(409);
    expect(toAppError(p("P2025")).status).toBe(404);
  });

  it("maps unknown errors to 500 INTERNAL", () => {
    expect(toAppError(new Error("boom"))).toMatchObject({
      status: 500,
      code: "INTERNAL",
    });
  });
});
