import { beforeEach, describe, expect, it } from "vitest";
import { settingsService } from "../../src/services/settings.service.js";
import { api } from "../helpers/app.js";
import { login, userWithToken } from "../helpers/auth.js";
import { prisma, resetDb } from "../helpers/db.js";
import {
  createCategory,
  createProperty,
  createWorker,
  PNG_1PX,
  requestInput,
} from "../helpers/fixtures.js";
import { completedJob } from "../helpers/flow.js";

describe("admin", () => {
  beforeEach(async () => {
    await resetDb();
    settingsService.invalidate();
  });

  it("role gates: customer 403, admin ok, superadmin-only endpoints 403 for admin", async () => {
    const customer = await userWithToken();
    const admin = await userWithToken("ADMIN");
    const sa = await userWithToken("SUPERADMIN");
    expect(
      (await api().get("/api/v1/admin/workers").set(customer.auth)).status,
    ).toBe(403);
    expect(
      (await api().get("/api/v1/admin/workers").set(admin.auth)).status,
    ).toBe(200);
    expect(
      (await api().get("/api/v1/admin/settings").set(admin.auth)).status,
    ).toBe(200);
    expect(
      (
        await api()
          .put("/api/v1/admin/settings")
          .set(admin.auth)
          .send({ commissionPercent: 12 })
      ).status,
    ).toBe(403);
    expect(
      (await api().get("/api/v1/admin/admins").set(admin.auth)).status,
    ).toBe(403);
    expect((await api().get("/api/v1/admin/admins").set(sa.auth)).status).toBe(
      200,
    );
    expect((await api().get("/api/v1/admin/stats").set(sa.auth)).status).toBe(
      200,
    );
  });

  it("verifying a worker makes them receive leads; reject/suspend rules; ID document is admin-only", async () => {
    const admin = await userWithToken("ADMIN");
    const cat = await createCategory();
    const w = await createWorker(cat.id, { status: "PENDING" });
    const owner = await userWithToken();
    const property = await createProperty(owner.user.id);

    const early = await api()
      .post(`/api/v1/admin/workers/${w.profile.id}/verify`)
      .set(admin.auth);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("WORKER_INCOMPLETE");
    await api()
      .post("/api/v1/worker/id-document")
      .set(w.auth)
      .attach("file", PNG_1PX, "id.png");

    const queue = await api()
      .get("/api/v1/admin/workers?status=PENDING")
      .set(admin.auth);
    expect(queue.body.items).toHaveLength(1);
    const doc = await api()
      .get(queue.body.items[0].idDocumentUrl)
      .set(admin.auth);
    expect(doc.status).toBe(200);
    expect(doc.headers["content-type"]).toBe("image/png");
    expect(
      (await api().get(queue.body.items[0].idDocumentUrl).set(w.auth)).status,
    ).toBe(403);

    const before = await api()
      .post("/api/v1/requests")
      .set(owner.auth)
      .send(requestInput(property.id, cat.id));
    expect(
      await prisma.requestMatch.count({ where: { requestId: before.body.id } }),
    ).toBe(0);

    const v = await api()
      .post(`/api/v1/admin/workers/${w.profile.id}/verify`)
      .set(admin.auth);
    expect(v.body.verificationStatus).toBe("VERIFIED");
    expect(
      (
        await api()
          .post(`/api/v1/admin/workers/${w.profile.id}/reject`)
          .set(admin.auth)
          .send({ reason: "too late" })
      ).status,
    ).toBe(409);
    const after = await api()
      .post("/api/v1/requests")
      .set(owner.auth)
      .send(requestInput(property.id, cat.id));
    expect(
      await prisma.requestMatch.count({ where: { requestId: after.body.id } }),
    ).toBe(1);

    const s = await api()
      .post(`/api/v1/admin/workers/${w.profile.id}/suspend`)
      .set(admin.auth)
      .send({ reason: "Complaints" });
    expect(s.body.verificationStatus).toBe("SUSPENDED");
    const third = await api()
      .post("/api/v1/requests")
      .set(owner.auth)
      .send(requestInput(property.id, cat.id));
    expect(
      await prisma.requestMatch.count({ where: { requestId: third.body.id } }),
    ).toBe(0);
    expect(
      await prisma.notification.count({
        where: { userId: w.user.id, type: "WORKER_VERIFIED" },
      }),
    ).toBe(1);
  });

  it("categories CRUD; inactive categories disappear from the public list", async () => {
    const admin = await userWithToken("ADMIN");
    const c = await api()
      .post("/api/v1/admin/categories")
      .set(admin.auth)
      .send({ slug: "roofing", name: "Roofing" });
    expect(c.status).toBe(201);
    expect(
      (
        await api()
          .post("/api/v1/admin/categories")
          .set(admin.auth)
          .send({ slug: "roofing", name: "Dup" })
      ).status,
    ).toBe(409);
    expect(
      (
        await api()
          .post("/api/v1/admin/categories")
          .set(admin.auth)
          .send({ slug: "Bad Slug!", name: "x" })
      ).status,
    ).toBe(422);
    await api()
      .patch(`/api/v1/admin/categories/${c.body.id}`)
      .set(admin.auth)
      .send({ isActive: false });
    expect(
      (await api().get("/api/v1/categories")).body.items.map(
        (x: { slug: string }) => x.slug,
      ),
    ).not.toContain("roofing");
    expect(
      (await api().get("/api/v1/admin/categories").set(admin.auth)).body.items,
    ).toHaveLength(1);
  });

  it("settings: validated partial update; new invoices use new commission, old ones keep their snapshot", async () => {
    const sa = await userWithToken("SUPERADMIN");
    const first = await completedJob();
    const bad = await api()
      .put("/api/v1/admin/settings")
      .set(sa.auth)
      .send({ commissionPercent: 90 });
    expect(bad.status).toBe(422);
    expect(
      (await api().put("/api/v1/admin/settings").set(sa.auth).send({})).status,
    ).toBe(422);
    const ok = await api()
      .put("/api/v1/admin/settings")
      .set(sa.auth)
      .send({
        commissionPercent: 12,
        quoteWindowHours: { LOW: 48, MEDIUM: 24, HIGH: 6, EMERGENCY: 1 },
      });
    expect(ok.body).toMatchObject({ commissionPercent: 12, gstPercent: 18 });

    const second = await completedJob();
    const oldInv = await prisma.invoice.findFirstOrThrow({
      where: { jobId: first.jobId },
    });
    const newInv = await prisma.invoice.findFirstOrThrow({
      where: { jobId: second.jobId },
    });
    expect(oldInv.commissionPaise).toBe(5000);
    expect(newInv.commissionPaise).toBe(6000);
    expect(
      (newInv.ratesSnapshot as { commissionPercent: number }).commissionPercent,
    ).toBe(12);
  });

  it("stats reflect paid invoices and rates", async () => {
    const admin = await userWithToken("ADMIN");
    const ctx = await completedJob();
    const inv = await prisma.invoice.findFirstOrThrow({
      where: { jobId: ctx.jobId },
    });
    await prisma.invoice.update({
      where: { id: inv.id },
      data: { status: "PAID" },
    });
    const s = await api().get("/api/v1/admin/stats").set(admin.auth);
    expect(s.body.money).toMatchObject({
      gmvPaise: 59000,
      commissionPaise: 5000,
      paidInvoices: 1,
    });
    expect(s.body.jobs).toEqual({ total: 1, completed: 1 });
    expect(s.body.rates).toMatchObject({
      acceptance: 1,
      completion: 1,
      dispute: 0,
    });
    expect(s.body.requests.COMPLETED).toBe(1);
  });

  it("superadmin manages admins", async () => {
    const sa = await userWithToken("SUPERADMIN");
    const created = await api().post("/api/v1/admin/admins").set(sa.auth).send({
      name: "Second Admin",
      email: "Admin2@Fixflow.in",
      password: "Temp@1234",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      email: "admin2@fixflow.in",
      globalRole: "ADMIN",
      mustChangePassword: true,
    });
    expect(
      (
        await api().post("/api/v1/admin/admins").set(sa.auth).send({
          name: "Again",
          email: "admin2@fixflow.in",
          password: "Temp@1234",
        })
      ).status,
    ).toBe(409);
    const { token } = await login("admin2@fixflow.in", "Temp@1234");
    expect(
      (
        await api()
          .get("/api/v1/admin/stats")
          .set("Authorization", `Bearer ${token}`)
      ).status,
    ).toBe(403); // must change password first
    expect(
      (await api().delete(`/api/v1/admin/admins/${sa.user.id}`).set(sa.auth))
        .status,
    ).toBe(409);
    expect(
      (
        await api()
          .delete(`/api/v1/admin/admins/${created.body.id}`)
          .set(sa.auth)
      ).status,
    ).toBe(204);
    expect(
      (
        await api()
          .post("/api/v1/auth/login")
          .send({ email: "admin2@fixflow.in", password: "Temp@1234" })
      ).status,
    ).toBe(401);
    expect(
      (await api().get("/api/v1/admin/admins").set(sa.auth)).body.items,
    ).toHaveLength(1);
  });
});
