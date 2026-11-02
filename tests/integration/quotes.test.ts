import { beforeEach, describe, expect, it } from "vitest";
import { settingsService } from "../../src/services/settings.service.js";
import { quoteService } from "../../src/services/quote.service.js";
import { api } from "../helpers/app.js";
import { userWithToken } from "../helpers/auth.js";
import { prisma, resetDb } from "../helpers/db.js";
import {
  addTenant,
  createCategory,
  createProperty,
  createWorker,
  PNG_1PX,
  quoteInput,
  requestInput,
} from "../helpers/fixtures.js";

async function openRequest(extra: Record<string, unknown> = {}) {
  const owner = await userWithToken("CUSTOMER", { phone: "+919811111111" });
  const tenant = await userWithToken();
  const property = await createProperty(owner.user.id);
  await addTenant(property.id, tenant.user.id);
  const category = await createCategory();
  return { owner, tenant, property, category, extra };
}

async function raise(
  ctx: Awaited<ReturnType<typeof openRequest>>,
  over: Record<string, unknown> = {},
) {
  const r = await api()
    .post("/api/v1/requests")
    .set(ctx.owner.auth)
    .send(requestInput(ctx.property.id, ctx.category.id, over));
  expect(r.status).toBe(201);
  return r.body;
}

const matchedIds = (requestId: string) =>
  prisma.requestMatch
    .findMany({ where: { requestId } })
    .then((m) => m.map((x) => x.workerProfileId).sort());

describe("matching", () => {
  beforeEach(async () => {
    await resetDb();
    settingsService.invalidate();
  });

  it("radius and eligibility rules", async () => {
    const ctx = await openRequest();
    const other = await createCategory();
    const near = await createWorker(ctx.category.id, { northKm: 3 });
    const far = await createWorker(ctx.category.id, { northKm: 25 });
    const ownRadius = await createWorker(ctx.category.id, {
      northKm: 15,
      radiusKm: 10,
    });
    const unverified = await createWorker(ctx.category.id, {
      northKm: 2,
      status: "PENDING",
    });
    const unavailable = await createWorker(ctx.category.id, {
      northKm: 2,
      isAvailable: false,
    });
    const wrongCat = await createWorker(other.id, { northKm: 2 });
    const edge = await createWorker(ctx.category.id, { northKm: 19.5 });

    const r = await raise(ctx);
    const ids = await matchedIds(r.id);
    expect(ids).toEqual([near.profile.id, edge.profile.id].sort());
    for (const w of [far, ownRadius, unverified, unavailable, wrongCat])
      expect(ids).not.toContain(w.profile.id);

    const n = await prisma.notification.count({
      where: { userId: near.user.id, type: "NEW_LEAD" },
    });
    expect(n).toBe(1);
  });

  it("tenant request is invisible to workers until approved", async () => {
    const ctx = await openRequest();
    const w = await createWorker(ctx.category.id);
    const r = await api()
      .post("/api/v1/requests")
      .set(ctx.tenant.auth)
      .send(requestInput(ctx.property.id, ctx.category.id));
    expect(
      (await api().get("/api/v1/worker/leads").set(w.auth)).body.items,
    ).toHaveLength(0);
    expect(
      (await api().get(`/api/v1/worker/leads/${r.body.id}`).set(w.auth)).status,
    ).toBe(404);
    await api()
      .post(`/api/v1/requests/${r.body.id}/approve`)
      .set(ctx.owner.auth)
      .send({});
    expect(
      (await api().get("/api/v1/worker/leads").set(w.auth)).body.items,
    ).toHaveLength(1);
  });

  it("fan-out limit + newcomer slots", async () => {
    const ctx = await openRequest();
    await prisma.platformSetting.upsert({
      where: { key: "fanoutLimit" },
      update: { value: 1 },
      create: { key: "fanoutLimit", value: 1 },
    });
    settingsService.invalidate();
    const pro = await createWorker(ctx.category.id, {
      northKm: 1,
      jobsCompleted: 50,
      bayesian: 4.9,
    });
    const pro2 = await createWorker(ctx.category.id, {
      northKm: 2,
      jobsCompleted: 40,
      bayesian: 4.0,
    });
    const n1 = await createWorker(ctx.category.id, { northKm: 3 });
    const n2 = await createWorker(ctx.category.id, { northKm: 4 });
    const n3 = await createWorker(ctx.category.id, { northKm: 18 });
    const r = await raise(ctx);
    const ids = await matchedIds(r.id);
    expect(ids).toContain(pro.profile.id);
    expect(ids).not.toContain(pro2.profile.id);
    expect(ids).toEqual(expect.arrayContaining([n1.profile.id, n2.profile.id]));
    expect(ids).not.toContain(n3.profile.id);
    expect(ids).toHaveLength(3);
  });

  it("reopen at 30 km reaches workers beyond 20 km", async () => {
    const ctx = await openRequest();
    const far = await createWorker(ctx.category.id, {
      northKm: 25,
      radiusKm: 20,
    });
    // Worker's own radius is 20 km, so even reopen excludes them; a 28 km-radius worker would need radius > 20 (max 20 via API).
    const r = await raise(ctx);
    await prisma.repairRequest.update({
      where: { id: r.id },
      data: { status: "EXPIRED" },
    });
    await api().post(`/api/v1/requests/${r.id}/reopen`).set(ctx.owner.auth);
    expect(await matchedIds(r.id)).not.toContain(far.profile.id);
    await prisma.workerProfile.update({
      where: { id: far.profile.id },
      data: { serviceRadiusKm: 30 },
    });
    await prisma.repairRequest.update({
      where: { id: r.id },
      data: { status: "EXPIRED", reopenedCount: 0 },
    });
    await api().post(`/api/v1/requests/${r.id}/reopen`).set(ctx.owner.auth);
    expect(await matchedIds(r.id)).toContain(far.profile.id);
  });
});

describe("leads + quotes", () => {
  beforeEach(async () => {
    await resetDb();
    settingsService.invalidate();
  });

  it("lead masks address/phone until acceptance, then unmasks", async () => {
    const ctx = await openRequest();
    const w = await createWorker(ctx.category.id, { northKm: 3.3 });
    const r = await raise(ctx);
    await api()
      .post(`/api/v1/requests/${r.id}/media`)
      .set(ctx.owner.auth)
      .attach("files", PNG_1PX, "a.png");

    const lead = (await api().get(`/api/v1/worker/leads/${r.id}`).set(w.auth))
      .body;
    expect(lead.unmasked).toBe(false);
    expect(lead.address).toBeNull();
    expect(lead.contact).toBeNull();
    expect(JSON.stringify(lead)).not.toContain("Test Street");
    expect(JSON.stringify(lead)).not.toContain("9811111111");
    expect(lead.location.lat).toBe(Math.round(ctx.property.lat * 100) / 100);
    expect(lead.approxDistanceKm).toBe(3.5);
    expect((await api().get(lead.media[0].url).set(w.auth)).status).toBe(200);

    const q = await api()
      .post(`/api/v1/requests/${r.id}/quotes`)
      .set(w.auth)
      .send(quoteInput());
    expect(q.status).toBe(201);
    const acc = await api()
      .post(`/api/v1/quotes/${q.body.id}/accept`)
      .set(ctx.owner.auth)
      .set("Idempotency-Key", "key-unmask-1")
      .send({ version: 1 });
    expect(acc.status).toBe(201);

    const after = (await api().get(`/api/v1/worker/leads/${r.id}`).set(w.auth))
      .body;
    expect(after.unmasked).toBe(true);
    expect(after.address.addressLine1).toBe("12 Test Street");
    expect(after.contact.phone).toBe("+919811111111");
    expect(after.jobId).toBe(acc.body.job.id);
  });

  it("one active quote per worker; revise bumps version; stale version → 409; withdraw", async () => {
    const ctx = await openRequest();
    const w = await createWorker(ctx.category.id);
    const r = await raise(ctx);
    const q1 = await api()
      .post(`/api/v1/requests/${r.id}/quotes`)
      .set(w.auth)
      .send(quoteInput());
    const dup = await api()
      .post(`/api/v1/requests/${r.id}/quotes`)
      .set(w.auth)
      .send(quoteInput());
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("QUOTE_EXISTS");

    const rev = await api()
      .patch(`/api/v1/quotes/${q1.body.id}`)
      .set(w.auth)
      .send({ labourPaise: 45000 });
    expect(rev.body).toMatchObject({ version: 2, totalPaise: 55000 });

    const stale = await api()
      .post(`/api/v1/quotes/${q1.body.id}/accept`)
      .set(ctx.owner.auth)
      .set("Idempotency-Key", "stale-key-01")
      .send({ version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("QUOTE_VERSION_MISMATCH");

    expect(
      (await api().post(`/api/v1/quotes/${q1.body.id}/withdraw`).set(w.auth))
        .body.status,
    ).toBe("WITHDRAWN");
    const again = await api()
      .post(`/api/v1/requests/${r.id}/quotes`)
      .set(w.auth)
      .send(quoteInput());
    expect(again.status).toBe(201);
  });

  it("unmatched / unverified workers cannot quote; deadline enforced; 422 on bad body", async () => {
    const ctx = await openRequest();
    const w = await createWorker(ctx.category.id);
    const r = await raise(ctx);
    const stranger = await createWorker(ctx.category.id, { northKm: 40 });
    expect(
      (
        await api()
          .post(`/api/v1/requests/${r.id}/quotes`)
          .set(stranger.auth)
          .send(quoteInput())
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .post(`/api/v1/requests/${r.id}/quotes`)
          .set(w.auth)
          .send(quoteInput({ labourPaise: -5 }))
      ).status,
    ).toBe(422);
    expect(
      (
        await api()
          .post(`/api/v1/requests/${r.id}/quotes`)
          .set(ctx.owner.auth)
          .send(quoteInput())
      ).status,
    ).toBe(403);
    await prisma.repairRequest.update({
      where: { id: r.id },
      data: { quoteDeadline: new Date(Date.now() - 1000) },
    });
    const late = await api()
      .post(`/api/v1/requests/${r.id}/quotes`)
      .set(w.auth)
      .send(quoteInput());
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("QUOTE_DEADLINE_PASSED");
  });

  it("payer sees quotes ranked with enrichment; workers see only theirs; tenant not payer cannot accept", async () => {
    const ctx = await openRequest();
    const a = await createWorker(ctx.category.id, { northKm: 15 });
    const b = await createWorker(ctx.category.id, {
      northKm: 1,
      jobsCompleted: 10,
      bayesian: 4.8,
    });
    const r = await raise(ctx);
    await api()
      .post(`/api/v1/requests/${r.id}/quotes`)
      .set(a.auth)
      .send(quoteInput());
    const qb = await api()
      .post(`/api/v1/requests/${r.id}/quotes`)
      .set(b.auth)
      .send(quoteInput({ labourPaise: 60000 }));
    const list = await api()
      .get(`/api/v1/requests/${r.id}/quotes`)
      .set(ctx.owner.auth);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items[0].worker.id).toBe(b.profile.id);
    expect(list.body.items[0].rankScore).toBeGreaterThan(
      list.body.items[1].rankScore,
    );
    expect(list.body.items[0].worker.jobsCompleted).toBe(10);
    expect(list.body.items[1].distanceKm).toBe(15);
    expect(
      (await api().get(`/api/v1/requests/${r.id}/quotes`).set(a.auth)).body
        .items,
    ).toHaveLength(1);

    const tenantTry = await api()
      .post(`/api/v1/quotes/${qb.body.id}/accept`)
      .set(ctx.tenant.auth)
      .set("Idempotency-Key", "tenant-try-1")
      .send({ version: 1 });
    expect(tenantTry.status).toBe(403);
    expect(
      (
        await api()
          .post(`/api/v1/quotes/${qb.body.id}/accept`)
          .set(ctx.owner.auth)
          .send({ version: 1 })
      ).status,
    ).toBe(422);
  });

  it("accept rejects siblings, creates job, request SCHEDULED; expired quote not acceptable", async () => {
    const ctx = await openRequest();
    const a = await createWorker(ctx.category.id);
    const b = await createWorker(ctx.category.id, { northKm: 5 });
    const r = await raise(ctx);
    const qa = await api()
      .post(`/api/v1/requests/${r.id}/quotes`)
      .set(a.auth)
      .send(quoteInput());
    const qb = await api()
      .post(`/api/v1/requests/${r.id}/quotes`)
      .set(b.auth)
      .send(quoteInput());
    await prisma.quote.update({
      where: { id: qa.body.id },
      data: { validUntil: new Date(Date.now() - 1000) },
    });
    const exp = await api()
      .post(`/api/v1/quotes/${qa.body.id}/accept`)
      .set(ctx.owner.auth)
      .set("Idempotency-Key", "expired-q-1")
      .send({ version: 1 });
    expect(exp.status).toBe(409);
    expect(exp.body.error.code).toBe("QUOTE_EXPIRED");

    const ok = await api()
      .post(`/api/v1/quotes/${qb.body.id}/accept`)
      .set(ctx.owner.auth)
      .set("Idempotency-Key", "accept-ok-1")
      .send({ version: 1 });
    expect(ok.status).toBe(201);
    expect(ok.body.request.status).toBe("SCHEDULED");
    expect(ok.body.job.subStatus).toBe("CONFIRMED");
    const statuses = await prisma.quote.findMany({
      where: { requestId: r.id },
      orderBy: { createdAt: "asc" },
    });
    expect(statuses.map((q) => q.status)).toEqual(["REJECTED", "ACCEPTED"]);
    expect(
      await prisma.notification.count({
        where: { userId: b.user.id, type: "QUOTE_ACCEPTED" },
      }),
    ).toBe(1);
  });

  it("concurrent accepts → exactly one job, the other 409; same Idempotency-Key replays identical response", async () => {
    const ctx = await openRequest();
    const a = await createWorker(ctx.category.id);
    const b = await createWorker(ctx.category.id, { northKm: 4 });
    const r = await raise(ctx);
    const qa = await api()
      .post(`/api/v1/requests/${r.id}/quotes`)
      .set(a.auth)
      .send(quoteInput());
    const qb = await api()
      .post(`/api/v1/requests/${r.id}/quotes`)
      .set(b.auth)
      .send(quoteInput());

    const [x, y] = await Promise.all([
      api()
        .post(`/api/v1/quotes/${qa.body.id}/accept`)
        .set(ctx.owner.auth)
        .set("Idempotency-Key", "race-key-aaa")
        .send({ version: 1 }),
      api()
        .post(`/api/v1/quotes/${qb.body.id}/accept`)
        .set(ctx.owner.auth)
        .set("Idempotency-Key", "race-key-bbb")
        .send({ version: 1 }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const loser = x.status === 409 ? x : y;
    expect(["QUOTE_ALREADY_ACCEPTED", "QUOTE_NOT_ACCEPTABLE"]).toContain(
      loser.body.error.code,
    );
    expect(await prisma.job.count({ where: { requestId: r.id } })).toBe(1);

    const winner = x.status === 201 ? x : y;
    const winnerKey = x.status === 201 ? "race-key-aaa" : "race-key-bbb";
    const winnerQuote = x.status === 201 ? qa : qb;
    const replay = await api()
      .post(`/api/v1/quotes/${winnerQuote.body.id}/accept`)
      .set(ctx.owner.auth)
      .set("Idempotency-Key", winnerKey)
      .send({ version: 1 });
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(winner.body);
    expect(replay.headers["idempotent-replay"]).toBe("true");

    const other = await userWithToken();
    const reused = await api()
      .post(`/api/v1/quotes/${winnerQuote.body.id}/accept`)
      .set(other.auth)
      .set("Idempotency-Key", winnerKey)
      .send({ version: 1 });
    expect(reused.status).toBe(409);
  });

  it("deadline expiry: no quotes → EXPIRED + notify; with quotes stays open", async () => {
    const ctx = await openRequest();
    const w = await createWorker(ctx.category.id);
    const empty = await raise(ctx);
    const quoted = await raise(ctx);
    await api()
      .post(`/api/v1/requests/${quoted.id}/quotes`)
      .set(w.auth)
      .send(quoteInput());
    await prisma.repairRequest.updateMany({
      data: { quoteDeadline: new Date(Date.now() - 1000) },
    });
    await quoteService.expireDue();
    expect(
      (
        await prisma.repairRequest.findUniqueOrThrow({
          where: { id: empty.id },
        })
      ).status,
    ).toBe("EXPIRED");
    expect(
      (
        await prisma.repairRequest.findUniqueOrThrow({
          where: { id: quoted.id },
        })
      ).status,
    ).toBe("OPEN_FOR_QUOTES");
    expect(
      await prisma.notification.count({
        where: { userId: ctx.owner.user.id, type: "REQUEST_EXPIRED" },
      }),
    ).toBe(1);
  });

  it("worker profile endpoints and public profile", async () => {
    const cat = await createCategory();
    const w = await userWithToken("WORKER");
    expect(
      (await api().get("/api/v1/worker/profile").set(w.auth)).body.error.code,
    ).toBe("WORKER_PROFILE_MISSING");
    const p = await api()
      .put("/api/v1/worker/profile")
      .set(w.auth)
      .send({
        baseLat: 30.33,
        baseLng: 78.03,
        state: "Uttarakhand",
        serviceRadiusKm: 15,
        gstin: "05abcde1234f1z5",
      });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({
      verificationStatus: "PENDING",
      gstin: "05ABCDE1234F1Z5",
    });
    expect(
      (
        await api()
          .put("/api/v1/worker/profile")
          .set(w.auth)
          .send({ baseLat: 30, baseLng: 78, state: "UK", serviceRadiusKm: 25 })
      ).status,
    ).toBe(422);
    const c = await api()
      .put("/api/v1/worker/categories")
      .set(w.auth)
      .send({ categories: [{ categoryId: cat.id, yearsExperience: 4 }] });
    expect(c.body.categories[0].slug).toBe(cat.slug);
    expect(
      (
        await api()
          .patch("/api/v1/worker/availability")
          .set(w.auth)
          .send({ isAvailable: false })
      ).body.isAvailable,
    ).toBe(false);
    const doc = await api()
      .post("/api/v1/worker/id-document")
      .set(w.auth)
      .attach("file", PNG_1PX, "id.png");
    expect(doc.status).toBe(201);
    expect(doc.body.hasIdDocument).toBe(true);
    expect((await api().get(`/api/v1/workers/${p.body.id}`)).status).toBe(404);
    await prisma.workerProfile.update({
      where: { id: p.body.id },
      data: { verificationStatus: "VERIFIED" },
    });
    const pub = await api().get(`/api/v1/workers/${p.body.id}`);
    expect(pub.status).toBe(200);
    expect(pub.body.rating.bayesian).toBe(4);
    expect(JSON.stringify(pub.body)).not.toContain("baseLat");
    const customer = await userWithToken();
    expect(
      (await api().get("/api/v1/worker/leads").set(customer.auth)).status,
    ).toBe(403);
  });
});
