import { beforeEach, describe, expect, it } from "vitest";
import { outbox } from "../../src/lib/mailer.js";
import { api } from "../helpers/app.js";
import { createUser, login, userWithToken } from "../helpers/auth.js";
import { prisma, resetDb } from "../helpers/db.js";
import {
  addTenant,
  createProperty,
  propertyInput,
} from "../helpers/fixtures.js";

const tokenFromMail = () => {
  const text = outbox.at(-1)!.text;
  return /invitations\/([A-Za-z0-9_-]+)/.exec(text)![1]!;
};

describe("properties", () => {
  beforeEach(async () => {
    await resetDb();
    outbox.length = 0;
  });

  it("owner CRUD", async () => {
    const { auth } = await userWithToken();
    const created = await api()
      .post("/api/v1/properties")
      .set(auth)
      .send(propertyInput());
    expect(created.status).toBe(201);
    expect(created.body.relation).toBe("OWNER");
    const id = created.body.id;

    const list = await api().get("/api/v1/properties").set(auth);
    expect(list.body.items).toHaveLength(1);

    const patched = await api()
      .patch(`/api/v1/properties/${id}`)
      .set(auth)
      .send({ label: "Renamed" });
    expect(patched.status).toBe(200);
    expect(patched.body.label).toBe("Renamed");

    expect(
      (await api().delete(`/api/v1/properties/${id}`).set(auth)).status,
    ).toBe(204);
    expect((await api().get(`/api/v1/properties/${id}`).set(auth)).status).toBe(
      404,
    );
  });

  it("validates input (422) and blocks workers (403)", async () => {
    const { auth } = await userWithToken();
    const bad = await api()
      .post("/api/v1/properties")
      .set(auth)
      .send(propertyInput({ pincode: "12", lat: 51.5 }));
    expect(bad.status).toBe(422);
    const worker = await userWithToken("WORKER");
    expect(
      (
        await api()
          .post("/api/v1/properties")
          .set(worker.auth)
          .send(propertyInput())
      ).status,
    ).toBe(403);
  });

  it("non-owner gets 404; tenant can read but not edit (403)", async () => {
    const owner = await userWithToken();
    const stranger = await userWithToken();
    const tenant = await userWithToken();
    const p = await createProperty(owner.user.id);
    await addTenant(p.id, tenant.user.id);

    expect(
      (await api().get(`/api/v1/properties/${p.id}`).set(stranger.auth)).status,
    ).toBe(404);
    expect(
      (
        await api()
          .patch(`/api/v1/properties/${p.id}`)
          .set(stranger.auth)
          .send({ label: "New name" })
      ).status,
    ).toBe(404);
    const t = await api().get(`/api/v1/properties/${p.id}`).set(tenant.auth);
    expect(t.status).toBe(200);
    expect(t.body.relation).toBe("TENANT");
    expect(
      (
        await api()
          .patch(`/api/v1/properties/${p.id}`)
          .set(tenant.auth)
          .send({ label: "New name" })
      ).status,
    ).toBe(403);
  });

  it("GET /properties for a tenant returns only rented properties", async () => {
    const owner = await userWithToken();
    const tenant = await userWithToken();
    const rented = await createProperty(owner.user.id, { label: "Rented" });
    await createProperty(owner.user.id, { label: "Other" });
    await addTenant(rented.id, tenant.user.id);
    const res = await api().get("/api/v1/properties").set(tenant.auth);
    expect(res.body.items.map((p: { label: string }) => p.label)).toEqual([
      "Rented",
    ]);
  });

  it("invitation happy path: email sent, preview, accept → active tenancy", async () => {
    const owner = await userWithToken();
    const p = await createProperty(owner.user.id);
    const inv = await api()
      .post(`/api/v1/properties/${p.id}/invitations`)
      .set(owner.auth)
      .send({ email: "Invitee@Test.fixflow" });
    expect(inv.status).toBe(201);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe("invitee@test.fixflow");
    const token = tokenFromMail();

    const preview = await api().get(`/api/v1/invitations/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      email: "invitee@test.fixflow",
      needsRegistration: true,
    });

    const invitee = await createUser({ email: "invitee@test.fixflow" });
    const { token: jwt } = await login(invitee.email);
    const acc = await api()
      .post(`/api/v1/invitations/${token}/accept`)
      .set("Authorization", `Bearer ${jwt}`);
    expect(acc.status).toBe(200);
    const tenancy = await prisma.tenancy.findFirstOrThrow({
      where: { tenantId: invitee.id },
    });
    expect(tenancy.status).toBe("ACTIVE");

    // Owner detail shows the tenant; stored token is hashed.
    const detail = await api()
      .get(`/api/v1/properties/${p.id}`)
      .set(owner.auth);
    expect(detail.body.tenants[0].email).toBe("invitee@test.fixflow");
    const stored = await prisma.invitation.findFirstOrThrow();
    expect(stored.tokenHash).not.toBe(token);
  });

  it("invitation is single-use, expiring and email-bound", async () => {
    const owner = await userWithToken();
    const p = await createProperty(owner.user.id);
    await api()
      .post(`/api/v1/properties/${p.id}/invitations`)
      .set(owner.auth)
      .send({ email: "a@test.fixflow" });
    const token = tokenFromMail();

    const wrong = await userWithToken("CUSTOMER", { email: "b@test.fixflow" });
    const mismatch = await api()
      .post(`/api/v1/invitations/${token}/accept`)
      .set(wrong.auth);
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.error.code).toBe("INVITATION_EMAIL_MISMATCH");

    const right = await userWithToken("CUSTOMER", { email: "a@test.fixflow" });
    expect(
      (await api().post(`/api/v1/invitations/${token}/accept`).set(right.auth))
        .status,
    ).toBe(200);
    const reuse = await api()
      .post(`/api/v1/invitations/${token}/accept`)
      .set(right.auth);
    expect(reuse.status).toBe(409);
    expect(reuse.body.error.code).toBe("INVITATION_USED");

    await api()
      .post(`/api/v1/properties/${p.id}/invitations`)
      .set(owner.auth)
      .send({ email: "c@test.fixflow" });
    const t2 = tokenFromMail();
    await prisma.invitation.updateMany({
      where: { email: "c@test.fixflow" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const exp = await api().get(`/api/v1/invitations/${t2}`);
    expect(exp.status).toBe(410);
    expect(
      (await api().get(`/api/v1/invitations/${"x".repeat(43)}`)).status,
    ).toBe(404);
  });

  it("end tenancy: owner ends, tenant loses access; tenant can leave own tenancy", async () => {
    const owner = await userWithToken();
    const tenant = await userWithToken();
    const p = await createProperty(owner.user.id);
    const t = await addTenant(p.id, tenant.user.id);
    expect(
      (
        await api()
          .post(`/api/v1/properties/${p.id}/tenancies/${t.id}/end`)
          .set(owner.auth)
      ).status,
    ).toBe(204);
    expect(
      (await api().get(`/api/v1/properties/${p.id}`).set(tenant.auth)).status,
    ).toBe(404);
    expect(
      (
        await api()
          .post(`/api/v1/properties/${p.id}/tenancies/${t.id}/end`)
          .set(owner.auth)
      ).status,
    ).toBe(409);

    const t2 = await addTenant(p.id, tenant.user.id);
    expect(
      (
        await api()
          .post(`/api/v1/properties/${p.id}/tenancies/${t2.id}/end`)
          .set(tenant.auth)
      ).status,
    ).toBe(204);
  });
});
