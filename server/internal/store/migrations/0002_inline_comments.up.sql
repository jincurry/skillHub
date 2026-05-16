-- Inline review comments: extend the existing review comments table so a
-- comment can optionally anchor to a specific file + line in the review's
-- diff snapshot. file_path='' means "general comment" (current behaviour
-- of all legacy rows). side ∈ ('','base','head') — base = left/old,
-- head = right/new — empty for general comments.
--
-- SQLite doesn't support `ADD COLUMN IF NOT EXISTS`. The columns may
-- already exist on legacy DBs that ran the inline backfills; in that
-- case the ALTER fails and SQLite raises an error which would abort the
-- migration. We guard each column individually via a savepoint pattern
-- inside the runner, but as a simpler approach this migration assumes
-- a clean schema. Existing DBs without these columns will get them on
-- first apply; DBs that somehow already have them must drop the
-- duplicates manually before re-running. This is acceptable because the
-- columns don't ship as inline backfills in store.go.
ALTER TABLE comments ADD COLUMN file_path TEXT    NOT NULL DEFAULT '';
ALTER TABLE comments ADD COLUMN line_no   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN side      TEXT    NOT NULL DEFAULT '';

-- Speeds up the file-grouped view in ReviewDetail's inline comment thread.
CREATE INDEX IF NOT EXISTS idx_comments_review_file ON comments(review_id, file_path);
