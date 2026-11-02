import { expect } from "vitest";
import { api } from "./app.js";
import { userWithToken } from "./auth.js";
import {
  addTenant,
  createCategory,
  createProperty,
  createWorker,
  PNG_1PX,
  quoteInput,
  requestInput,
} from "./fixtures.js";

type Auth = { Authorization: string };

/** Owner + tenant + property + worker; tenant raises, owner approves, worker quotes ₹500, owner accepts. */
export async function scheduledJob(
  opts: {
    workerGstin?: string | null;
    workerState?: string;
    labourPaise?: number;
    materialsPaise?: number;
  } = {},
) {
  const owner = await userWithToken();
  const tenant = await userWithToken();
  const property = await createProperty(owner.user.id);
  await addTenant(property.id, tenant.user.id);
  const category = await createCategory();
  const worker = await createWorker(category.id, {
    gstin: opts.workerGstin ?? null,
    state: opts.workerState,
  });
  const r = await api()
    .post("/api/v1/requests")
    .set(tenant.auth)
    .send(requestInput(property.id, category.id));
  await api()
    .post(`/api/v1/requests/${r.body.id}/approve`)
    .set(owner.auth)
    .send({});
  const q = await api()
    .post(`/api/v1/requests/${r.body.id}/quotes`)
    .set(worker.auth)
    .send(
      quoteInput({
        labourPaise: opts.labourPaise ?? 40000,
        materialsPaise: opts.materialsPaise ?? 10000,
      }),
    );
  const acc = await api()
    .post(`/api/v1/quotes/${q.body.id}/accept`)
    .set(owner.auth)
    .set("Idempotency-Key", `k-${q.body.id}`)
    .send({ version: 1 });
  expect(acc.status).toBe(201);
  return {
    owner,
    tenant,
    property,
    category,
    worker,
    requestId: r.body.id as string,
    jobId: acc.body.job.id as string,
  };
}

export async function doWork(jobId: string, worker: Auth) {
  for (const step of ["en-route", "arrive", "start"]) {
    const res = await api().post(`/api/v1/jobs/${jobId}/${step}`).set(worker);
    expect(res.status).toBe(200);
  }
  const done = await api()
    .post(`/api/v1/jobs/${jobId}/complete`)
    .set(worker)
    .attach("files", PNG_1PX, "after.png");
  expect(done.status).toBe(200);
  return done.body;
}

export async function completedJob(
  opts: Parameters<typeof scheduledJob>[0] = {},
) {
  const ctx = await scheduledJob(opts);
  await doWork(ctx.jobId, ctx.worker.auth);
  const c = await api()
    .post(`/api/v1/jobs/${ctx.jobId}/confirm`)
    .set(ctx.tenant.auth);
  expect(c.status).toBe(200);
  return ctx;
}
