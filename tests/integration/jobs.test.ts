import { beforeEach, describe, expect, it } from "vitest";
import { jobService } from "../../src/services/job.service.js";
import { settingsService } from "../../src/services/settings.service.js";
import { api } from "../helpers/app.js";
import { userWithToken } from "../helpers/auth.js";
import { prisma, resetDb } from "../helpers/db.js";
import { PNG_1PX } from "../helpers/fixtures.js";
import { completedJob, doWork, scheduledJob } from "../helpers/flow.js";

describe("jobs", () => {
  beforeEach(async () => {
    await resetDb();
    settingsService.invalidate();
  });

  it("sub-status order is enforced and only the assigned worker can act", async () => {
    const ctx = await scheduledJob();
    const arriveFirst = await api()
      .post(`/api/v1/jobs/${ctx.jobId}/arrive`)
      .set(ctx.worker.auth);
    expect(arriveFirst.status).toBe(409);
    const startFirst = await api()
      .post(`/api/v1/jobs/${ctx.jobId}/start`)
      .set(ctx.worker.auth);
    expect(startFirst.status).toBe(409);
    expect(startFirst.body.error.code).toBe("MUST_ARRIVE_FIRST");
    const other = await userWithToken("WORKER");
    expect(
      (await api().post(`/api/v1/jobs/${ctx.jobId}/en-route`).set(other.auth))
        .status,
    ).toBe(404);
    expect(
      (
        await api()
          .post(`/api/v1/jobs/${ctx.jobId}/en-route`)
          .set(ctx.owner.auth)
      ).status,
    ).toBe(403);

    const er = await api()
      .post(`/api/v1/jobs/${ctx.jobId}/en-route`)
      .set(ctx.worker.auth);
    expect(er.body).toMatchObject({
      subStatus: "EN_ROUTE",
      workerActions: ["arrive"],
    });
    await api().post(`/api/v1/jobs/${ctx.jobId}/arrive`).set(ctx.worker.auth);
    const st = await api()
      .post(`/api/v1/jobs/${ctx.jobId}/start`)
      .set(ctx.worker.auth);
    expect(st.body).toMatchObject({
      subStatus: "WORKING",
      requestStatus: "IN_PROGRESS",
    });

    const noPhotos = await api()
      .post(`/api/v1/jobs/${ctx.jobId}/complete`)
      .set(ctx.worker.auth)
      .field("finalAmountPaise", "50000");
    expect(noPhotos.status).toBe(422);
    const tooMuch = await api()
      .post(`/api/v1/jobs/${ctx.jobId}/complete`)
      .set(ctx.worker.auth)
      .field("finalAmountPaise", "90000")
      .attach("files", PNG_1PX, "a.png");
    expect(tooMuch.status).toBe(422);
    const done = await api()
      .post(`/api/v1/jobs/${ctx.jobId}/complete`)
      .set(ctx.worker.auth)
      .attach("files", PNG_1PX, "a.png");
    expect(done.body).toMatchObject({
      subStatus: "DONE",
      requestStatus: "PENDING_SIGN_OFF",
    });
    expect(done.body.afterPhotos).toHaveLength(1);

    const tl = await api()
      .get(`/api/v1/requests/${ctx.requestId}/timeline`)
      .set(ctx.owner.auth);
    expect(tl.body.items.map((e: { action: string }) => e.action)).toEqual([
      "create",
      "approve",
      "accept_quote",
      "job_en_route",
      "job_arrive",
      "start",
      "complete",
    ]);
  });

  it("confirm → COMPLETED with the ₹500 reference invoice; customer can't see payout, worker can", async () => {
    const ctx = await completedJob();
    const reqRes = await api()
      .get(`/api/v1/requests/${ctx.requestId}`)
      .set(ctx.owner.auth);
    expect(reqRes.body.status).toBe("COMPLETED");

    const inv = await api()
      .get(`/api/v1/jobs/${ctx.jobId}/invoice`)
      .set(ctx.owner.auth);
    expect(inv.status).toBe(200);
    expect(inv.body).toMatchObject({
      servicePaise: 50000,
      cgstPaise: 4500,
      sgstPaise: 4500,
      totalPaise: 59000,
      status: "ISSUED",
      breakdown: null,
    });
    expect(inv.body.number).toMatch(/^FF\/\d{4}-\d{2}\/000001$/);

    const wInv = await api()
      .get(`/api/v1/invoices/${inv.body.id}`)
      .set(ctx.worker.auth);
    expect(wInv.body.breakdown).toMatchObject({
      commissionPaise: 5000,
      commissionGstPaise: 900,
      workerPayoutPaise: 44100,
    });
    const stranger = await userWithToken();
    expect(
      (await api().get(`/api/v1/invoices/${inv.body.id}`).set(stranger.auth))
        .status,
    ).toBe(404);

    const earnings = await api()
      .get("/api/v1/worker/earnings")
      .set(ctx.worker.auth);
    expect(earnings.body.totals).toMatchObject({
      pendingPaise: 44100,
      paidPaise: 0,
      jobs: 1,
    });
    const stats = await prisma.workerStats.findFirstOrThrow({
      where: { workerProfileId: ctx.worker.profile.id },
    });
    expect(stats.jobsCompleted).toBe(1);
  });

  it("invoice numbers increase; inter-state + registered worker", async () => {
    await completedJob();
    const b = await completedJob({
      workerGstin: "07ABCDE1234F1Z5",
      workerState: "Delhi",
    });
    const inv = await api()
      .get(`/api/v1/jobs/${b.jobId}/invoice`)
      .set(b.worker.auth);
    expect(inv.body.number).toMatch(/000002$/);
    expect(inv.body).toMatchObject({
      igstPaise: 9000,
      cgstPaise: 0,
      gstMode: "WORKER_REGISTERED",
    });
    expect(inv.body.breakdown.tcsPaise).toBe(250);
  });

  it("invoice not issued before completion", async () => {
    const ctx = await scheduledJob();
    const res = await api()
      .get(`/api/v1/jobs/${ctx.jobId}/invoice`)
      .set(ctx.owner.auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("INVOICE_NOT_ISSUED");
  });

  it("dispute → admin resolves COMPLETE (invoice) or CANCEL (no invoice)", async () => {
    const admin = await userWithToken("ADMIN");
    const a = await scheduledJob();
    await doWork(a.jobId, a.worker.auth);
    const d = await api()
      .post(`/api/v1/jobs/${a.jobId}/dispute`)
      .set(a.owner.auth)
      .send({ reason: "Leak came back after an hour" });
    expect(d.body.requestStatus).toBe("DISPUTED");
    const list = await api()
      .get("/api/v1/admin/disputes?status=OPEN")
      .set(admin.auth);
    expect(list.body.items).toHaveLength(1);
    expect(
      (await api().get("/api/v1/admin/disputes").set(a.owner.auth)).status,
    ).toBe(403);
    const res = await api()
      .post(`/api/v1/admin/disputes/${list.body.items[0].id}/resolve`)
      .set(admin.auth)
      .send({ outcome: "COMPLETE", resolution: "Worker fixed it on revisit" });
    expect(res.body).toMatchObject({
      status: "RESOLVED",
      requestStatus: "COMPLETED",
    });
    expect(
      (await api().get(`/api/v1/jobs/${a.jobId}/invoice`).set(a.owner.auth))
        .status,
    ).toBe(200);
    const again = await api()
      .post(`/api/v1/admin/disputes/${list.body.items[0].id}/resolve`)
      .set(admin.auth)
      .send({ outcome: "CANCEL", resolution: "Second try here" });
    expect(again.status).toBe(409);

    const b = await scheduledJob();
    await doWork(b.jobId, b.worker.auth);
    await api()
      .post(`/api/v1/jobs/${b.jobId}/dispute`)
      .set(b.tenant.auth)
      .send({ reason: "Work not done at all here" });
    const open = (
      await api().get("/api/v1/admin/disputes?status=OPEN").set(admin.auth)
    ).body.items[0];
    const cancel = await api()
      .post(`/api/v1/admin/disputes/${open.id}/resolve`)
      .set(admin.auth)
      .send({ outcome: "CANCEL", resolution: "Refund customer, no charge" });
    expect(cancel.body.requestStatus).toBe("CANCELLED");
    expect(
      (await api().get(`/api/v1/jobs/${b.jobId}/invoice`).set(b.owner.auth))
        .status,
    ).toBe(404);
  });

  it("auto-confirms after 72 h", async () => {
    const ctx = await scheduledJob();
    await doWork(ctx.jobId, ctx.worker.auth);
    expect(await jobService.autoConfirmDue()).toBe(0);
    await prisma.job.update({
      where: { id: ctx.jobId },
      data: { completedAt: new Date(Date.now() - 73 * 3_600_000) },
    });
    expect(await jobService.autoConfirmDue()).toBe(1);
    const r = await prisma.repairRequest.findUniqueOrThrow({
      where: { id: ctx.requestId },
    });
    expect(r.status).toBe("COMPLETED");
    expect(await prisma.invoice.count()).toBe(1);
    const ev = await prisma.requestEvent.findFirst({
      where: { requestId: ctx.requestId, action: "auto_confirm" },
    });
    expect(ev?.actorId).toBeNull();
  });

  it("job lists are scoped", async () => {
    const ctx = await scheduledJob();
    const other = await scheduledJob();
    expect(
      (await api().get("/api/v1/worker/jobs").set(ctx.worker.auth)).body.items,
    ).toHaveLength(1);
    expect(
      (await api().get("/api/v1/jobs?active=true").set(ctx.tenant.auth)).body
        .items,
    ).toHaveLength(1);
    expect(
      (await api().get(`/api/v1/jobs/${other.jobId}`).set(ctx.tenant.auth))
        .status,
    ).toBe(404);
  });
});

describe("reviews", () => {
  beforeEach(async () => {
    await resetDb();
    settingsService.invalidate();
  });

  it("only after COMPLETED; dimensions by role; once per user; stats updated atomically", async () => {
    const pending = await scheduledJob();
    expect(
      (
        await api()
          .post(`/api/v1/jobs/${pending.jobId}/reviews`)
          .set(pending.owner.auth)
          .send({ overall: 5 })
      ).status,
    ).toBe(409);

    const ctx = await completedJob();
    // Tenant (raiser, on-site) may not rate value; owner (payer) may not rate quality.
    const tBad = await api()
      .post(`/api/v1/jobs/${ctx.jobId}/reviews`)
      .set(ctx.tenant.auth)
      .send({ overall: 4, value: 3 });
    expect(tBad.status).toBe(422);
    expect(tBad.body.error.details[0].code).toBe("DIMENSION_NOT_ALLOWED");
    const oBad = await api()
      .post(`/api/v1/jobs/${ctx.jobId}/reviews`)
      .set(ctx.owner.auth)
      .send({ overall: 4, quality: 3 });
    expect(oBad.status).toBe(422);

    const t = await api()
      .post(`/api/v1/jobs/${ctx.jobId}/reviews`)
      .set(ctx.tenant.auth)
      .send({
        overall: 5,
        quality: 5,
        punctuality: 4,
        behaviour: 5,
        wouldRehire: true,
        comment: "Great",
      });
    expect(t.status).toBe(201);
    const o = await api()
      .post(`/api/v1/jobs/${ctx.jobId}/reviews`)
      .set(ctx.owner.auth)
      .send({ overall: 3, value: 2, finalCostMatchedQuote: true });
    expect(o.status).toBe(201);
    const dup = await api()
      .post(`/api/v1/jobs/${ctx.jobId}/reviews`)
      .set(ctx.owner.auth)
      .send({ overall: 3 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ALREADY_REVIEWED");

    const w = await api()
      .post(`/api/v1/jobs/${ctx.jobId}/reviews`)
      .set(ctx.worker.auth)
      .send({ overall: 5, comment: "Polite customer" });
    expect(w.body.revieweeType).toBe("CUSTOMER");
    expect(
      (
        await api()
          .post(`/api/v1/jobs/${ctx.jobId}/reviews`)
          .set(ctx.worker.auth)
          .send({ overall: 5 })
      ).status,
    ).toBe(409);
    const stranger = await userWithToken();
    expect(
      (
        await api()
          .post(`/api/v1/jobs/${ctx.jobId}/reviews`)
          .set(stranger.auth)
          .send({ overall: 1 })
      ).status,
    ).toBe(404);

    const stats = await prisma.workerStats.findFirstOrThrow({
      where: { workerProfileId: ctx.worker.profile.id },
    });
    expect(stats).toMatchObject({
      ratingCount: 2,
      sumOverall: 8,
      sumQuality: 5,
      countQuality: 1,
      sumValue: 2,
      countValue: 1,
      jobsCompleted: 1,
    });
    expect(stats.bayesianScore).toBeCloseTo((10 * 4 + 8) / 12, 6);

    // Edit once within 24 h adjusts stats by the delta.
    const edit = await api()
      .patch(`/api/v1/reviews/${o.body.id}`)
      .set(ctx.owner.auth)
      .send({ overall: 5, value: 4 });
    expect(edit.body).toMatchObject({ overall: 5, value: 4, editable: false });
    const again = await api()
      .patch(`/api/v1/reviews/${o.body.id}`)
      .set(ctx.owner.auth)
      .send({ overall: 1 });
    expect(again.status).toBe(409);
    const after = await prisma.workerStats.findFirstOrThrow({
      where: { workerProfileId: ctx.worker.profile.id },
    });
    expect(after).toMatchObject({
      ratingCount: 2,
      sumOverall: 10,
      sumValue: 4,
      countValue: 1,
    });

    const pub = await api().get(
      `/api/v1/workers/${ctx.worker.profile.id}/reviews`,
    );
    expect(pub.body.items).toHaveLength(2);
    const prof = await api().get(`/api/v1/workers/${ctx.worker.profile.id}`);
    expect(prof.body.rating).toMatchObject({
      count: 2,
      overall: 5,
      value: 4,
      quality: 5,
    });
  });

  it("review window closes after 7 days", async () => {
    const ctx = await completedJob();
    await prisma.job.update({
      where: { id: ctx.jobId },
      data: { confirmedAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    const res = await api()
      .post(`/api/v1/jobs/${ctx.jobId}/reviews`)
      .set(ctx.tenant.auth)
      .send({ overall: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REVIEW_WINDOW_CLOSED");
  });

  it("concurrent reviews keep stats consistent", async () => {
    const ctx = await completedJob();
    await Promise.all([
      api()
        .post(`/api/v1/jobs/${ctx.jobId}/reviews`)
        .set(ctx.tenant.auth)
        .send({ overall: 4 }),
      api()
        .post(`/api/v1/jobs/${ctx.jobId}/reviews`)
        .set(ctx.owner.auth)
        .send({ overall: 2 }),
    ]);
    const s = await prisma.workerStats.findFirstOrThrow({
      where: { workerProfileId: ctx.worker.profile.id },
    });
    expect(s).toMatchObject({ ratingCount: 2, sumOverall: 6 });
    expect(s.bayesianScore).toBeCloseTo((40 + 6) / 12, 6);
  });
});
