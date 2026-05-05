-- Add checkout_url column to payments. Populated asynchronously after
-- the inbound /subscriptions/checkout response is sent (Bictorys' WAF
-- rejects outbound calls while the inbound socket is still open). The
-- frontend polls /checkout/:reference/status until this column is set.
ALTER TABLE "payments" ADD COLUMN "checkout_url" TEXT;
