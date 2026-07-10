-- Proposed migration: track individual execution attempts of a digest schedule.
-- One row per run, so the dashboard can show "last 20 runs" per workspace,
-- filtered by status ('pending' | 'running' | 'succeeded' | 'failed').

CREATE TABLE digest_schedule_runs (
  id SERIAL PRIMARY KEY,
  schedule_id INTEGER REFERENCES digest_schedules(id),
  workspace_id INTEGER REFERENCES workspaces(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  error_message VARCHAR(500),
  triggered_by VARCHAR(255),
  started_at TIMESTAMP NOT NULL DEFAULT now(),
  finished_at TIMESTAMP
);

-- Dashboard query pattern (from the service layer):
--   SELECT * FROM digest_schedule_runs
--   WHERE workspace_id = $1 AND status = $2
--   ORDER BY started_at DESC
--   LIMIT 20;
