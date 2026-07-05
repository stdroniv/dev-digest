-- Proposed schema for the "PR review" module: workspaces, reviews, and
-- per-line review comments. workspaces already shipped in an earlier
-- migration and is included here only for context/FK targets.

CREATE TABLE workspaces (
  workspace_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON workspaces (LOWER(slug));

-- New table: one row per agent review run against a pull request.
CREATE TABLE pr_reviews (
  review_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  pull_request_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'running' | 'completed' | 'failed'
  -- Sourced from the GitHub API. Support keeps getting tickets that "find all
  -- reviews by octocat" scans every row and does a JSONB->>'login' compare per
  -- row because there's nothing to index or join on.
  author JSONB NOT NULL, -- { "id": 123, "login": "octocat", "email": "octo@example.com" }
  score NUMERIC CHECK (score BETWEEN 0 AND 100),
  -- Dashboard query counts `WHERE score IS NULL` as "needs attention", but that
  -- bucket silently mixes reviews still awaiting a score with ones where the
  -- scoring step crashed and never wrote a value -- both look identical to the UI.
  external_id TEXT UNIQUE,
  -- Webhook replays occasionally arrive before the dedupe feature populates this
  -- column for older rows, and reviews keep showing up twice in the studio because
  -- multiple such rows share external_id = NULL and the UNIQUE constraint lets them all in.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON pr_reviews (workspace_id);

-- The studio's "reviews" list is always filtered by both workspace and
-- status (e.g. "show failed reviews for this workspace"):
--   SELECT * FROM pr_reviews WHERE workspace_id = $1 AND status = $2 ORDER BY created_at DESC;

-- New table: one row per inline comment the reviewer agent leaves on a diff.
CREATE TABLE review_comments (
  comment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  review_id BIGINT NOT NULL REFERENCES pr_reviews(review_id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  -- Free-form labels the agent attaches, e.g. {'security','perf'}. The UI
  -- filters the comment list by tag containment: tags @> ARRAY['security'].
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON review_comments (review_id);
