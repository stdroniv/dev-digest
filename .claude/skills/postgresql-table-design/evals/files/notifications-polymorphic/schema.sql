-- Proposed schema for an in-app notifications feed. A notification can be
-- about a review finding, a review comment, or a digest schedule run, so a
-- single "subject_type" + "subject_id" pair is used to point at whichever
-- table produced it, instead of one FK column per source.

CREATE TABLE notifications (
  notification_id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  -- One of: 'review', 'review_comment', 'schedule_run'. The application
  -- layer decides which table `subject_id` refers to based on this value.
  subject_type TEXT NOT NULL,
  subject_id BIGINT NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX ON notifications (workspace_id);

-- Feed query: unread notifications for a workspace, newest first.
--   SELECT * FROM notifications
--   WHERE workspace_id = $1 AND read_at IS NULL
--   ORDER BY created_at DESC;
