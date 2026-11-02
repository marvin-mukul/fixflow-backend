import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../helpers/app.js";
import { TEST_PASSWORD, userWithToken } from "../helpers/auth.js";
import { prisma, resetDb } from "../helpers/db.js";
import {
  addTenant,
  createCategory,
  createProperty,
  requestInput,
} from "../helpers/fixtures.js";

describe("account deletion", () => {
  beforeEach(resetDb);

  it("anonymises the user, ends tenancies and revokes sessions", async () => {
    const owner = await userWithToken();
    const tenant = await userWithToken("CUSTOMER", { phone: "+919812345678" });
    const p = await createProperty(owner.user.id);
    await addTenant(p.id, tenant.user.id);
    expect(
      (
        await api()
          .delete("/api/v1/auth/me")
          .set(tenant.auth)
          .send({ password: "wrong" })
      ).status,
    ).toBe(422);
    const res = await api()
      .delete("/api/v1/auth/me")
      .set(tenant.auth)
      .send({ password: TEST_PASSWORD });
    expect(res.status).toBe(204);
    const u = await prisma.user.findUniqueOrThrow({
      where: { id: tenant.user.id },
    });
    expect(u).toMatchObject({
      status: "DELETED",
      name: "Deleted user",
      phone: null,
    });
    expect(u.email).toContain("@fixflow.invalid");
    expect(
      await prisma.tenancy.count({
        where: { tenantId: tenant.user.id, status: "ACTIVE" },
      }),
    ).toBe(0);
    expect((await api().get("/api/v1/auth/me").set(tenant.auth)).status).toBe(
      401,
    );
  });

  it("is blocked while the user has open requests", async () => {
    const owner = await userWithToken();
    const p = await createProperty(owner.user.id);
    const c = await createCategory();
    await api()
      .post("/api/v1/requests")
      .set(owner.auth)
      .send(requestInput(p.id, c.id));
    const res = await api()
      .delete("/api/v1/auth/me")
      .set(owner.auth)
      .send({ password: TEST_PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ACCOUNT_HAS_OPEN_ITEMS");
  });
});
