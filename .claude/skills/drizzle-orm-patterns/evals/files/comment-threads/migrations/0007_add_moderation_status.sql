-- Migration 0007: flag comments awaiting moderation review.
-- `comments` currently holds ~42M rows in production.

ALTER TABLE comments ADD COLUMN moderation_status TEXT NOT NULL;
