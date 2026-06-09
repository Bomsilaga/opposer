-- Trial users table — tracks registered free trial users server-side
CREATE TABLE IF NOT EXISTS trial_users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text UNIQUE NOT NULL,
  token      uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  runs_used  int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  last_used  timestamptz
);

-- Only service role can access (Edge Functions use service role key)
ALTER TABLE trial_users ENABLE ROW LEVEL SECURITY;
