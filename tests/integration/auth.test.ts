import express from "express";
import supertest from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { errorHandler } from "../../src/middlewares/errorHandler.js";
import { requireAuth } from "../../src/middlewares/auth.js";
import { requireRole } from "../../src/middlewares/requireRole.js";
import { api } from "../helpers/app.js";
import { createUser, login, TEST_PASSWORD } from "../helpers/auth.js";
import { prisma, resetDb } from "../helpers/db.js";

const cookieOf = (res: supertest.Response) =>
  ([] as string[]).concat(res.headers["set-cookie"] ?? [])[0]?.split(";")[0] ??
  "";

describe("auth", () => {
  beforeEach(resetDb);

  it("registers, then /me works with the access token", async () => {
    const reg = await api().post("/api/v1/auth/register").send({
      name: "New Owner",
      email: "New@Test.fixflow",
      password: "Secret@123",
      role: "CUSTOMER",
    });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({
      email: "new@test.fixflow",
      globalRole: "CUSTOMER",
    });
    expect(reg.headers["set-cookie"]?.[0]).toMatch(
      /ff_refresh=.*HttpOnly.*SameSite=Lax/i,
    );
    const me = await api()
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${reg.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("new@test.fixflow");
    const stored = await prisma.user.findUniqueOrThrow({
      where: { email: "new@test.fixflow" },
    });
    expect(stored.passwordHash.startsWith("$2")).toBe(true);
    expect(stored.passwordHash).toContain("$12$");
  });

  it("rejects duplicate email (409) and weak passwords (422)", async () => {
    await createUser({ email: "dup@test.fixflow" });
    const dup = await api().post("/api/v1/auth/register").send({
      name: "Dup",
      email: "dup@test.fixflow",
      password: "Secret@123",
      role: "WORKER",
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("EMAIL_TAKEN");
    const weak = await api().post("/api/v1/auth/register").send({
      name: "W",
      email: "w@test.fixflow",
      password: "short",
      role: "ADMIN",
    });
    expect(weak.status).toBe(422);
    const paths = weak.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(
      expect.arrayContaining(["body.password", "body.role", "body.name"]),
    );
  });

  it("wrong password → 401, unknown email → 401", async () => {
    const u = await createUser();
    expect(
      (
        await api()
          .post("/api/v1/auth/login")
          .send({ email: u.email, password: "Nope@1234" })
      ).status,
    ).toBe(401);
    expect(
      (
        await api()
          .post("/api/v1/auth/login")
          .send({ email: "ghost@test.fixflow", password: "x" })
      ).status,
    ).toBe(401);
  });

  it("suspended user cannot log in", async () => {
    const u = await createUser();
    await prisma.user.update({
      where: { id: u.id },
      data: { status: "SUSPENDED" },
    });
    const res = await api()
      .post("/api/v1/auth/login")
      .send({ email: u.email, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("refresh rotates; reusing the old token → 401 and revokes the family", async () => {
    const u = await createUser();
    const { cookie: first } = await login(u.email);

    const r1 = await api().post("/api/v1/auth/refresh").set("Cookie", first);
    expect(r1.status).toBe(200);
    const second = cookieOf(r1);
    expect(second).not.toBe(first);

    const reuse = await api().post("/api/v1/auth/refresh").set("Cookie", first);
    expect(reuse.status).toBe(401);

    // The legitimately rotated token is now dead too (family revoked).
    const after = await api()
      .post("/api/v1/auth/refresh")
      .set("Cookie", second);
    expect(after.status).toBe(401);
    const live = await prisma.refreshToken.count({
      where: { userId: u.id, revokedAt: null },
    });
    expect(live).toBe(0);
  });

  it("refresh without cookie → 401; logout revokes", async () => {
    expect((await api().post("/api/v1/auth/refresh")).status).toBe(401);
    const u = await createUser();
    const { cookie } = await login(u.email);
    expect(
      (await api().post("/api/v1/auth/logout").set("Cookie", cookie)).status,
    ).toBe(204);
    expect(
      (await api().post("/api/v1/auth/refresh").set("Cookie", cookie)).status,
    ).toBe(401);
  });

  it("superadmin must change password before using other endpoints", async () => {
    const su = await createUser({
      role: "SUPERADMIN",
      mustChangePassword: true,
    });
    const { token, user } = await login(su.email);
    expect(user.mustChangePassword).toBe(true);
    const auth = { Authorization: `Bearer ${token}` };
    expect((await api().get("/api/v1/auth/me").set(auth)).status).toBe(200);

    const wrong = await api()
      .post("/api/v1/auth/change-password")
      .set(auth)
      .send({ currentPassword: "bad", newPassword: "Fresh@1234" });
    expect(wrong.status).toBe(422);

    const ok = await api()
      .post("/api/v1/auth/change-password")
      .set(auth)
      .send({ currentPassword: TEST_PASSWORD, newPassword: "Fresh@1234" });
    expect(ok.status).toBe(200);
    expect(ok.body.user.mustChangePassword).toBe(false);
    await login(su.email, "Fresh@1234");
  });

  it("missing/invalid bearer → 401 envelope", async () => {
    const res = await api()
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer nope");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("requireRole → 403 for the wrong role, SUPERADMIN passes ADMIN gates", async () => {
    const app = express();
    app.get("/admin-only", requireAuth(), requireRole("ADMIN"), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    const customer = await createUser();
    const sa = await createUser({ role: "SUPERADMIN" });
    const c = await login(customer.email);
    const s = await login(sa.email);
    expect(
      (
        await supertest(app)
          .get("/admin-only")
          .set("Authorization", `Bearer ${c.token}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await supertest(app)
          .get("/admin-only")
          .set("Authorization", `Bearer ${s.token}`)
      ).status,
    ).toBe(200);
  });

  it("rate limits /auth/* → 429", async () => {
    const agent = supertest(createApp());
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (
        await agent
          .post("/api/v1/auth/login")
          .send({ email: "x@test.fixflow", password: "x" })
      ).status;
    }
    expect(last).toBe(429);
  });
});
