-- Data Cache Tables for Background Refresh System
-- Stores pre-computed API responses so dashboard loads instantly

-- P&L cached responses
CREATE TABLE IF NOT EXISTS cached_api_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_type TEXT NOT NULL,              -- 'pnl' or 'ads'
  cache_key TEXT NOT NULL UNIQUE,        -- e.g. 'pnl:ALL:last_7d' or 'ads:today:ALL'
  response_data JSONB NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cached_api_lookup ON cached_api_data(cache_type, cache_key);

-- RLS: admin only
ALTER TABLE cached_api_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can manage cache" ON cached_api_data
  FOR ALL USING (
    EXISTS (SELECT 1 FROM employees WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- Allow service role (cron) full access
CREATE POLICY "Service role full access" ON cached_api_data
  FOR ALL USING (auth.role() = 'service_role');
