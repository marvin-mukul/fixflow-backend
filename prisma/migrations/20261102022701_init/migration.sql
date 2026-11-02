-- CreateEnum
CREATE TYPE "GlobalRole" AS ENUM ('SUPERADMIN', 'ADMIN', 'CUSTOMER', 'WORKER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('HOUSE', 'FLAT', 'OTHER');

-- CreateEnum
CREATE TYPE "TenancyStatus" AS ENUM ('INVITED', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "InvitationType" AS ENUM ('TENANT', 'OWNER');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('AWAITING_OWNER_JOIN', 'PENDING_APPROVAL', 'OPEN_FOR_QUOTES', 'SCHEDULED', 'IN_PROGRESS', 'PENDING_SIGN_OFF', 'COMPLETED', 'DISPUTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('BEFORE', 'AFTER', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('SUBMITTED', 'WITHDRAWN', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "JobSubStatus" AS ENUM ('CONFIRMED', 'EN_ROUTE', 'ARRIVED', 'WORKING', 'DONE');

-- CreateEnum
CREATE TYPE "GstMode" AS ENUM ('PLATFORM_9_5', 'WORKER_REGISTERED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'PAID', 'PAID_OFFLINE', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "RevieweeType" AS ENUM ('WORKER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "global_role" "GlobalRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_setting" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "label" TEXT NOT NULL,
    "type" "PropertyType" NOT NULL,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "is_owner_occupied" BOOLEAN NOT NULL DEFAULT false,
    "auto_approve_emergency" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenancy" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "status" "TenancyStatus" NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" UUID NOT NULL,
    "type" "InvitationType" NOT NULL,
    "property_id" UUID NOT NULL,
    "inviter_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_category" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_profile" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "bio" TEXT NOT NULL DEFAULT '',
    "base_lat" DOUBLE PRECISION NOT NULL,
    "base_lng" DOUBLE PRECISION NOT NULL,
    "service_radius_km" INTEGER NOT NULL DEFAULT 20,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "id_document_path" TEXT,
    "gstin" TEXT,
    "state" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "verified_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_category" (
    "worker_profile_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "years_experience" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "worker_category_pkey" PRIMARY KEY ("worker_profile_id","category_id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_member" (
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_member_pkey" PRIMARY KEY ("organization_id","user_id")
);

-- CreateTable
CREATE TABLE "repair_request" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "raised_by_id" UUID NOT NULL,
    "payer_user_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "Priority" NOT NULL,
    "status" "RequestStatus" NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "quote_deadline" TIMESTAMP(3),
    "preferred_slots" JSONB NOT NULL DEFAULT '[]',
    "search_radius_km" INTEGER NOT NULL DEFAULT 20,
    "reopened_count" INTEGER NOT NULL DEFAULT 0,
    "cancel_reason" TEXT,
    "reminder_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repair_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_media" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "job_id" UUID,
    "path" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "request_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_match" (
    "request_id" UUID NOT NULL,
    "worker_profile_id" UUID NOT NULL,
    "distance_km" DOUBLE PRECISION NOT NULL,
    "rank_score" DOUBLE PRECISION NOT NULL,
    "notified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewed_at" TIMESTAMP(3),

    CONSTRAINT "request_match_pkey" PRIMARY KEY ("request_id","worker_profile_id")
);

-- CreateTable
CREATE TABLE "quote" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "worker_profile_id" UUID NOT NULL,
    "labour_paise" INTEGER NOT NULL,
    "materials_paise" INTEGER NOT NULL,
    "notes" TEXT,
    "eta_hours" INTEGER NOT NULL,
    "proposed_slot" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3) NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'SUBMITTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_key" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "route" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "worker_profile_id" UUID NOT NULL,
    "sub_status" "JobSubStatus" NOT NULL DEFAULT 'CONFIRMED',
    "scheduled_start" TIMESTAMP(3),
    "scheduled_end" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "final_amount_paise" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counter" (
    "fy" TEXT NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_counter_pkey" PRIMARY KEY ("fy")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "service_paise" INTEGER NOT NULL,
    "cgst_paise" INTEGER NOT NULL,
    "sgst_paise" INTEGER NOT NULL,
    "igst_paise" INTEGER NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "commission_paise" INTEGER NOT NULL,
    "commission_gst_paise" INTEGER NOT NULL,
    "tcs_paise" INTEGER NOT NULL,
    "worker_payout_paise" INTEGER NOT NULL,
    "gst_mode" "GstMode" NOT NULL,
    "rates_snapshot" JSONB NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "offline_marked_at" TIMESTAMP(3),
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_order_id" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "amount_paise" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "method" TEXT,
    "failure_reason" TEXT,
    "refunded_paise" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_event" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "reviewee_type" "RevieweeType" NOT NULL,
    "quality" INTEGER,
    "punctuality" INTEGER,
    "behaviour" INTEGER,
    "value" INTEGER,
    "overall" INTEGER NOT NULL,
    "would_rehire" BOOLEAN,
    "final_cost_matched_quote" BOOLEAN,
    "comment" TEXT,
    "edited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_stats" (
    "worker_profile_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "sum_overall" INTEGER NOT NULL DEFAULT 0,
    "sum_quality" INTEGER NOT NULL DEFAULT 0,
    "sum_punctuality" INTEGER NOT NULL DEFAULT 0,
    "sum_behaviour" INTEGER NOT NULL DEFAULT 0,
    "sum_value" INTEGER NOT NULL DEFAULT 0,
    "count_quality" INTEGER NOT NULL DEFAULT 0,
    "count_punctuality" INTEGER NOT NULL DEFAULT 0,
    "count_behaviour" INTEGER NOT NULL DEFAULT 0,
    "count_value" INTEGER NOT NULL DEFAULT 0,
    "jobs_completed" INTEGER NOT NULL DEFAULT 0,
    "cancellations" INTEGER NOT NULL DEFAULT 0,
    "avg_response_minutes" DOUBLE PRECISION,
    "bayesian_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_stats_pkey" PRIMARY KEY ("worker_profile_id","category_id")
);

-- CreateTable
CREATE TABLE "dispute" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "raised_by_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_event" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "from_status" "RequestStatus",
    "to_status" "RequestStatus" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_family_id_idx" ON "refresh_token"("family_id");

-- CreateIndex
CREATE INDEX "refresh_token_user_id_idx" ON "refresh_token"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_setting_key_key" ON "platform_setting"("key");

-- CreateIndex
CREATE INDEX "property_owner_id_idx" ON "property"("owner_id");

-- CreateIndex
CREATE INDEX "property_lat_lng_idx" ON "property"("lat", "lng");

-- CreateIndex
CREATE INDEX "tenancy_property_id_status_idx" ON "tenancy"("property_id", "status");

-- CreateIndex
CREATE INDEX "tenancy_tenant_id_status_idx" ON "tenancy"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_property_id_idx" ON "invitation"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_category_slug_key" ON "service_category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "worker_profile_user_id_key" ON "worker_profile"("user_id");

-- CreateIndex
CREATE INDEX "worker_profile_verification_status_is_available_idx" ON "worker_profile"("verification_status", "is_available");

-- CreateIndex
CREATE INDEX "worker_profile_base_lat_base_lng_idx" ON "worker_profile"("base_lat", "base_lng");

-- CreateIndex
CREATE INDEX "worker_category_category_id_idx" ON "worker_category"("category_id");

-- CreateIndex
CREATE INDEX "repair_request_status_priority_created_at_idx" ON "repair_request"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "repair_request_property_id_idx" ON "repair_request"("property_id");

-- CreateIndex
CREATE INDEX "repair_request_raised_by_id_idx" ON "repair_request"("raised_by_id");

-- CreateIndex
CREATE INDEX "repair_request_payer_user_id_idx" ON "repair_request"("payer_user_id");

-- CreateIndex
CREATE INDEX "request_media_request_id_idx" ON "request_media"("request_id");

-- CreateIndex
CREATE INDEX "request_match_worker_profile_id_notified_at_idx" ON "request_match"("worker_profile_id", "notified_at");

-- CreateIndex
CREATE INDEX "quote_request_id_status_idx" ON "quote"("request_id", "status");

-- CreateIndex
CREATE INDEX "quote_worker_profile_id_idx" ON "quote"("worker_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_key_key_key" ON "idempotency_key"("key");

-- CreateIndex
CREATE UNIQUE INDEX "job_request_id_key" ON "job"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_quote_id_key" ON "job"("quote_id");

-- CreateIndex
CREATE INDEX "job_worker_profile_id_idx" ON "job"("worker_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_job_id_key" ON "invoice"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_number_key" ON "invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_order_id_key" ON "payment"("provider_order_id");

-- CreateIndex
CREATE INDEX "payment_invoice_id_status_idx" ON "payment"("invoice_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_event_provider_event_id_key" ON "payment_event"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_job_id_reviewer_id_key" ON "review"("job_id", "reviewer_id");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_job_id_key" ON "dispute"("job_id");

-- CreateIndex
CREATE INDEX "dispute_status_idx" ON "dispute"("status");

-- CreateIndex
CREATE INDEX "request_event_request_id_created_at_idx" ON "request_event"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_user_id_read_at_idx" ON "notification"("user_id", "read_at");

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property" ADD CONSTRAINT "property_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy" ADD CONSTRAINT "tenancy_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy" ADD CONSTRAINT "tenancy_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_profile" ADD CONSTRAINT "worker_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_profile" ADD CONSTRAINT "worker_profile_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_profile" ADD CONSTRAINT "worker_profile_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_category" ADD CONSTRAINT "worker_category_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_category" ADD CONSTRAINT "worker_category_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_member" ADD CONSTRAINT "organization_member_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_member" ADD CONSTRAINT "organization_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_request" ADD CONSTRAINT "repair_request_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_request" ADD CONSTRAINT "repair_request_raised_by_id_fkey" FOREIGN KEY ("raised_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_request" ADD CONSTRAINT "repair_request_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_request" ADD CONSTRAINT "repair_request_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_request" ADD CONSTRAINT "repair_request_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_media" ADD CONSTRAINT "request_media_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "repair_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_media" ADD CONSTRAINT "request_media_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_media" ADD CONSTRAINT "request_media_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_match" ADD CONSTRAINT "request_match_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "repair_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_match" ADD CONSTRAINT "request_match_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "repair_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "repair_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_stats" ADD CONSTRAINT "worker_stats_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_stats" ADD CONSTRAINT "worker_stats_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_raised_by_id_fkey" FOREIGN KEY ("raised_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_event" ADD CONSTRAINT "request_event_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "repair_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_event" ADD CONSTRAINT "request_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
