-- Subscription/billing dimension. Adds:
--   1. organizations.status (gates team-workspace access)
--   2. subscription_plans (DB-backed, admin-editable)
--   3. subscriptions (one per org; null until checkout starts)
--   4. payments (audit trail, idempotence on bictorys_charge_id)
--
-- Per product call: existing teams MUST pay too — they're flipped to
-- SUSPENDED here so admins see the subscribe banner on next login.
-- New orgs created after this migration default to DRAFT and only become
-- ACTIVE on the first successful Bictorys webhook.

-- ============================================================
-- Enums
-- ============================================================
CREATE TYPE "OrganizationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED');
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE "SubscriptionStatus" AS ENUM (
  'PENDING_PAYMENT',
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELLED',
  'SUSPENDED'
);
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- ============================================================
-- Organization.status
-- ============================================================
ALTER TABLE "organizations" ADD COLUMN "status" "OrganizationStatus" NOT NULL DEFAULT 'DRAFT';

-- Backfill: every org that exists today predates the paywall — flip them
-- to SUSPENDED so admins are forced through the subscribe flow on next
-- login. The org still exists, members still see it in the switcher, but
-- write actions get blocked until a Subscription is ACTIVE.
UPDATE "organizations" SET "status" = 'SUSPENDED';

CREATE INDEX "organizations_status_idx" ON "organizations"("status");

-- ============================================================
-- subscription_plans
-- ============================================================
CREATE TABLE "subscription_plans" (
  "id"            TEXT        NOT NULL,
  "slug"          TEXT        NOT NULL,
  "name"          TEXT        NOT NULL,
  "description"   TEXT,
  "prices"        JSONB       NOT NULL,
  "max_projects"  INTEGER,
  "max_members"   INTEGER,
  "features"      TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "display_order" INTEGER     NOT NULL DEFAULT 0,
  "is_active"     BOOLEAN     NOT NULL DEFAULT true,
  "is_custom"     BOOLEAN     NOT NULL DEFAULT false,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_plans_slug_key" ON "subscription_plans"("slug");
CREATE INDEX "subscription_plans_is_active_display_order_idx"
  ON "subscription_plans"("is_active", "display_order");

-- ============================================================
-- subscriptions
-- ============================================================
CREATE TABLE "subscriptions" (
  "id"                    TEXT               NOT NULL,
  "organization_id"       TEXT               NOT NULL,
  "plan_id"               TEXT               NOT NULL,
  "billing_cycle"         "BillingCycle"     NOT NULL,
  "currency"              TEXT               NOT NULL DEFAULT 'XOF',
  "status"                "SubscriptionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "trial_ends_at"         TIMESTAMP(3),
  "current_period_start"  TIMESTAMP(3),
  "current_period_end"    TIMESTAMP(3),
  "next_billing_at"       TIMESTAMP(3),
  "cancel_at_period_end"  BOOLEAN            NOT NULL DEFAULT false,
  "cancelled_at"          TIMESTAMP(3),
  "created_at"            TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3)       NOT NULL,

  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscriptions_organization_id_key" ON "subscriptions"("organization_id");
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");
CREATE INDEX "subscriptions_next_billing_at_idx" ON "subscriptions"("next_billing_at");

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- payments
-- ============================================================
CREATE TABLE "payments" (
  "id"                  TEXT            NOT NULL,
  "subscription_id"     TEXT            NOT NULL,
  "bictorys_charge_id"  TEXT,
  "payment_reference"   TEXT            NOT NULL,
  "amount"              INTEGER         NOT NULL,
  "currency"            TEXT            NOT NULL,
  "status"              "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "payment_method"      TEXT,
  "failure_reason"      TEXT,
  "created_at"          TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at"        TIMESTAMP(3),
  "webhook_received_at" TIMESTAMP(3),

  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payments_bictorys_charge_id_key" ON "payments"("bictorys_charge_id");
CREATE UNIQUE INDEX "payments_payment_reference_key" ON "payments"("payment_reference");
CREATE INDEX "payments_subscription_id_idx" ON "payments"("subscription_id");
CREATE INDEX "payments_status_idx" ON "payments"("status");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
