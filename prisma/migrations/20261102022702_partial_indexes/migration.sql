-- Partial unique indexes Prisma cannot express (requirements.md §8).

-- One active quote per worker per request.
CREATE UNIQUE INDEX "quote_one_active_per_worker"
  ON "quote" ("request_id", "worker_profile_id")
  WHERE "status" IN ('SUBMITTED', 'ACCEPTED');

-- One ACTIVE tenancy per (property, tenant).
CREATE UNIQUE INDEX "tenancy_one_active_per_tenant"
  ON "tenancy" ("property_id", "tenant_id")
  WHERE "status" = 'ACTIVE';

-- Money and ratings sanity checks.
ALTER TABLE "quote" ADD CONSTRAINT "quote_money_nonneg" CHECK ("labour_paise" >= 0 AND "materials_paise" >= 0);
ALTER TABLE "review" ADD CONSTRAINT "review_overall_range" CHECK ("overall" BETWEEN 1 AND 5);
ALTER TABLE "worker_profile" ADD CONSTRAINT "worker_radius_range" CHECK ("service_radius_km" BETWEEN 1 AND 30);
