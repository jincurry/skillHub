-- Composite indexes for the audit feed: the UI lists by recency and lets
-- the user filter by actor or target. Without these, large audit_logs
-- tables fall back to a scan + filesort.
CREATE INDEX IF NOT EXISTS idx_audit_actor_created  ON audit_logs(actor,  created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target_created ON audit_logs(target, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action_created ON audit_logs(action, created_at DESC);
