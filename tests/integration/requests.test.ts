import { beforeEach, describe, expect, it } from "vitest";
import { requestService } from "../../src/services/request.service.js";
import { api } from "../helpers/app.js";
import { userWithToken } from "../helpers/auth.js";
import { prisma, resetDb } from "../helpers/db.js";
import {
  addTenant,
  createCategory,
  createProperty,
  PNG_1PX,
  requestInput,
} from "../helpers/fixtures.js";

async function scenario(propertyOver: Record<string, unknown> = {}) {
  const owner = await userWithToken();
  const tenant = await userWithToken();
  const property = await createProperty(owner.user.id, propertyOver);
  await addTenant(property.id, tenant.user.id);
  const category = await createCategory();
  return { owner, tenant, property, category };
}

describe("requests", () => {
  beforeEach(resetDb);

  it("tenant request → PENDING_APPROVAL, owner notified; owner approves → OPEN with deadline", async () => {
    const { owner, tenant, property, category } = await scenario();
    const res = await api()
      .post("/api/v1/requests")
      .set(tenant.auth)
      .send(requestInput(property.id, category.id));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING_APPROVAL");
    expect(res.body.payer.id).toBe(owner.user.id);
    expect(res.body.availableActions).toEqual(["cancel"]);

    const count = await api()
      .get("/api/v1/notifications/unread-count")
      .set(owner.auth);
    expect(count.body.count).toBe(1);

    const forbidden = await api()
      .post(`/api/v1/requests/${res.body.id}/approve`)
      .set(tenant.auth)
      .send({});
    expect(forbidden.status).toBe(403);

    const approved = await api()
      .post(`/api/v1/requests/${res.body.id}/approve`)
      .set(owner.auth)
      .send({ tenantPays: true });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("OPEN_FOR_QUOTES");
    expect(approved.body.payer.id).toBe(tenant.user.id);
    const hours =
      (new Date(approved.body.quoteDeadline).getTime() - Date.now()) /
      3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);

    const again = await api()
      .post(`/api/v1/requests/${res.body.id}/approve`)
      .set(owner.auth)
      .send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("owner request skips approval; EMERGENCY auto-approves only when the property allows it", async () => {
    const { owner, tenant, property, category } = await scenario({
      autoApproveEmergency: true,
    });
    const own = await api()
      .post("/api/v1/requests")
      .set(owner.auth)
      .send(requestInput(property.id, category.id));
    expect(own.body.status).toBe("OPEN_FOR_QUOTES");

    const emergency = await api()
      .post("/api/v1/requests")
      .set(tenant.auth)
      .send(requestInput(property.id, category.id, { priority: "EMERGENCY" }));
    expect(emergency.body.status).toBe("OPEN_FOR_QUOTES");
    const hours =
      (new Date(emergency.body.quoteDeadline).getTime() - Date.now()) /
      3_600_000;
    expect(hours).toBeLessThanOrEqual(1);

    await prisma.property.update({
      where: { id: property.id },
      data: { autoApproveEmergency: false },
    });
    const gated = await api()
      .post("/api/v1/requests")
      .set(tenant.auth)
      .send(requestInput(property.id, category.id, { priority: "EMERGENCY" }));
    expect(gated.body.status).toBe("PENDING_APPROVAL");
  });

  it("IDOR: tenant of property A gets 404 on property B's request and cannot raise there", async () => {
    const a = await scenario();
    const b = await scenario();
    const reqB = await api()
      .post("/api/v1/requests")
      .set(b.owner.auth)
      .send(requestInput(b.property.id, b.category.id));
    expect(
      (await api().get(`/api/v1/requests/${reqB.body.id}`).set(a.tenant.auth))
        .status,
    ).toBe(404);
    expect(
      (
        await api()
          .get(`/api/v1/requests/${reqB.body.id}/timeline`)
          .set(a.tenant.auth)
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .post(`/api/v1/requests/${reqB.body.id}/cancel`)
          .set(a.tenant.auth)
          .send({ reason: "nope nope" })
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .post("/api/v1/requests")
          .set(a.tenant.auth)
          .send(requestInput(b.property.id, b.category.id))
      ).status,
    ).toBe(404);
    const list = await api().get("/api/v1/requests").set(a.tenant.auth);
    expect(list.body.items).toHaveLength(0);
  });

  it("validation 422 and worker 403", async () => {
    const { tenant, property, category } = await scenario();
    const bad = await api()
      .post("/api/v1/requests")
      .set(tenant.auth)
      .send(
        requestInput(property.id, category.id, {
          title: "x",
          priority: "URGENT",
        }),
      );
    expect(bad.status).toBe(422);
    const worker = await userWithToken("WORKER");
    expect(
      (
        await api()
          .post("/api/v1/requests")
          .set(worker.auth)
          .send(requestInput(property.id, category.id))
      ).status,
    ).toBe(403);
  });

  it("reject, cancel, illegal transitions and timeline order", async () => {
    const { owner, tenant, property, category } = await scenario();
    const r1 = await api()
      .post("/api/v1/requests")
      .set(tenant.auth)
      .send(requestInput(property.id, category.id));
    const rej = await api()
      .post(`/api/v1/requests/${r1.body.id}/reject`)
      .set(owner.auth)
      .send({ reason: "Not urgent" });
    expect(rej.body.status).toBe("REJECTED");
    expect(
      (
        await api()
          .post(`/api/v1/requests/${r1.body.id}/cancel`)
          .set(tenant.auth)
          .send({ reason: "changed mind" })
      ).status,
    ).toBe(409);

    const r2 = await api()
      .post("/api/v1/requests")
      .set(tenant.auth)
      .send(requestInput(property.id, category.id));
    await api()
      .post(`/api/v1/requests/${r2.body.id}/approve`)
      .set(owner.auth)
      .send({});
    const can = await api()
      .post(`/api/v1/requests/${r2.body.id}/cancel`)
      .set(tenant.auth)
      .send({ reason: "Fixed it myself" });
    expect(can.body.status).toBe("CANCELLED");
    expect(
      (
        await api()
          .post(`/api/v1/requests/${r2.body.id}/reopen`)
          .set(tenant.auth)
      ).status,
    ).toBe(409);

    const tl = await api()
      .get(`/api/v1/requests/${r2.body.id}/timeline`)
      .set(owner.auth);
    expect(tl.body.items.map((e: { action: string }) => e.action)).toEqual([
      "create",
      "approve",
      "cancel",
    ]);
    expect(tl.body.items[1].actor.id).toBe(owner.user.id);
  });

  it("reopen works once from EXPIRED with the wider radius", async () => {
    const { owner, property, category } = await scenario();
    const r = await api()
      .post("/api/v1/requests")
      .set(owner.auth)
      .send(requestInput(property.id, category.id));
    await prisma.repairRequest.update({
      where: { id: r.body.id },
      data: { status: "EXPIRED" },
    });
    const re = await api()
      .post(`/api/v1/requests/${r.body.id}/reopen`)
      .set(owner.auth);
    expect(re.status).toBe(200);
    expect(re.body).toMatchObject({
      status: "OPEN_FOR_QUOTES",
      reopenedCount: 1,
      searchRadiusKm: 30,
    });
    await prisma.repairRequest.update({
      where: { id: r.body.id },
      data: { status: "EXPIRED" },
    });
    const twice = await api()
      .post(`/api/v1/requests/${r.body.id}/reopen`)
      .set(owner.auth);
    expect(twice.status).toBe(409);
  });

  it("uploads: accepts real images, rejects wrong magic bytes and >5 MB; media is access-controlled", async () => {
    const { owner, tenant, property, category } = await scenario();
    const r = await api()
      .post("/api/v1/requests")
      .set(tenant.auth)
      .send(requestInput(property.id, category.id));
    const ok = await api()
      .post(`/api/v1/requests/${r.body.id}/media`)
      .set(tenant.auth)
      .attach("files", PNG_1PX, "leak.png");
    expect(ok.status).toBe(201);
    expect(ok.body.media).toHaveLength(1);

    const fake = await api()
      .post(`/api/v1/requests/${r.body.id}/media`)
      .set(tenant.auth)
      .attach("files", Buffer.from("not an image at all"), {
        filename: "x.png",
        contentType: "image/png",
      });
    expect(fake.status).toBe(422);
    expect(fake.body.error.details[0].code).toBe("INVALID_FILE_TYPE");

    const big = Buffer.concat([PNG_1PX, Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const tooBig = await api()
      .post(`/api/v1/requests/${r.body.id}/media`)
      .set(tenant.auth)
      .attach("files", big, "big.png");
    expect(tooBig.status).toBe(422);

    const url = ok.body.media[0].url as string;
    const dl = await api().get(url).set(owner.auth);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toBe("image/png");
    const stranger = await userWithToken();
    expect((await api().get(url).set(stranger.auth)).status).toBe(404);
  });

  it("ending a tenancy transfers open requests to the owner, history stays with owner", async () => {
    const { owner, tenant, property, category } = await scenario();
    const r = await api()
      .post("/api/v1/requests")
      .set(tenant.auth)
      .send(requestInput(property.id, category.id));
    const t = await prisma.tenancy.findFirstOrThrow({
      where: { tenantId: tenant.user.id },
    });
    await api()
      .post(`/api/v1/properties/${property.id}/tenancies/${t.id}/end`)
      .set(owner.auth);
    const after = await api()
      .get(`/api/v1/requests/${r.body.id}`)
      .set(owner.auth);
    expect(after.body.raisedBy.id).toBe(owner.user.id);
    expect(after.body.myRelations).toEqual(
      expect.arrayContaining(["OWNER", "RAISER", "PAYER"]),
    );
    expect(
      (await api().get(`/api/v1/requests/${r.body.id}`).set(tenant.auth))
        .status,
    ).toBe(404);
    expect(
      (
        await api()
          .post("/api/v1/requests")
          .set(tenant.auth)
          .send(requestInput(property.id, category.id))
      ).status,
    ).toBe(404);
    const tl = await api()
      .get(`/api/v1/requests/${r.body.id}/timeline`)
      .set(owner.auth);
    expect(tl.body.items.at(-1).action).toBe("transfer_to_owner");
  });

  it("list filters by status and scope=approvals, paginates", async () => {
    const { owner, tenant, property, category } = await scenario();
    for (let i = 0; i < 3; i++)
      await api()
        .post("/api/v1/requests")
        .set(tenant.auth)
        .send(requestInput(property.id, category.id));
    await api()
      .post("/api/v1/requests")
      .set(owner.auth)
      .send(requestInput(property.id, category.id));
    const approvals = await api()
      .get("/api/v1/requests?scope=approvals")
      .set(owner.auth);
    expect(approvals.body.items).toHaveLength(3);
    const open = await api()
      .get("/api/v1/requests?status=OPEN_FOR_QUOTES")
      .set(owner.auth);
    expect(open.body.items).toHaveLength(1);
    const p1 = await api().get("/api/v1/requests?limit=2").set(owner.auth);
    expect(p1.body.items).toHaveLength(2);
    const p2 = await api()
      .get(`/api/v1/requests?limit=2&cursor=${p1.body.nextCursor}`)
      .set(owner.auth);
    expect(p2.body.items).toHaveLength(2);
    expect(p2.body.nextCursor).toBeNull();
  });

  it("approval reminder fires once after 24 h", async () => {
    const { owner, tenant, property, category } = await scenario();
    const r = await api()
      .post("/api/v1/requests")
      .set(tenant.auth)
      .send(requestInput(property.id, category.id));
    await prisma.repairRequest.update({
      where: { id: r.body.id },
      data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    expect(await requestService.sendApprovalReminders()).toBe(1);
    expect(await requestService.sendApprovalReminders()).toBe(0);
    const n = await prisma.notification.count({
      where: { userId: owner.user.id, type: "APPROVAL_REMINDER" },
    });
    expect(n).toBe(1);
  });

  it("notifications: list, read one, read all", async () => {
    const { owner, tenant, property, category } = await scenario();
    await api()
      .post("/api/v1/requests")
      .set(tenant.auth)
      .send(requestInput(property.id, category.id));
    await api()
      .post("/api/v1/requests")
      .set(tenant.auth)
      .send(requestInput(property.id, category.id));
    const list = await api().get("/api/v1/notifications").set(owner.auth);
    expect(list.body.items).toHaveLength(2);
    expect(
      (
        await api()
          .post(`/api/v1/notifications/${list.body.items[0].id}/read`)
          .set(owner.auth)
      ).status,
    ).toBe(204);
    expect(
      (await api().get("/api/v1/notifications/unread-count").set(owner.auth))
        .body.count,
    ).toBe(1);
    expect(
      (
        await api()
          .post(`/api/v1/notifications/${list.body.items[0].id}/read`)
          .set(tenant.auth)
      ).status,
    ).toBe(404);
    await api().post("/api/v1/notifications/read-all").set(owner.auth);
    expect(
      (await api().get("/api/v1/notifications/unread-count").set(owner.auth))
        .body.count,
    ).toBe(0);
  });

  it("categories are public", async () => {
    await createCategory("plumbing-x");
    const res = await api().get("/api/v1/categories");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });
});
