-- Pre-existing duplicates would fail the unique index below. Suffix the 2nd+
-- skill in each (workspace_id, lower(name)) group (" 2", " 3", …, oldest kept)
-- before enforcing uniqueness.
WITH d AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "workspace_id", lower("name")
      ORDER BY "created_at", "id"
    ) AS rn
  FROM "skills"
)
UPDATE "skills" s
SET "name" = s."name" || ' ' || d.rn
FROM d
WHERE s."id" = d."id" AND d.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "skills_ws_name_uq" ON "skills" USING btree ("workspace_id",lower("name"));