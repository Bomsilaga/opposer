ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS stripe_customer_id      text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  text,
  ADD COLUMN IF NOT EXISTS payment_provider        text DEFAULT 'gumroad';

CREATE INDEX IF NOT EXISTS idx_subscribers_stripe_sub
  ON subscribers (stripe_subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscribers_stripe_cust
  ON subscribers (stripe_customer_id);
