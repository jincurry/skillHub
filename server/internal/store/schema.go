package store

const schemaSQL = `
CREATE TABLE IF NOT EXISTS users (
  username      TEXT PRIMARY KEY,
  display       TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'Member',
  team          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  bio           TEXT NOT NULL DEFAULT '',
  location      TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT NOT NULL DEFAULT '',
  cover_preset  TEXT NOT NULL DEFAULT 'sunset',
  cover_from    TEXT NOT NULL DEFAULT '',
  cover_to      TEXT NOT NULL DEFAULT '',
  is_admin      INTEGER NOT NULL DEFAULT 0,
  joined_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_providers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  base_url    TEXT    NOT NULL,
  model       TEXT    NOT NULL,
  api_key_enc TEXT    NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS namespaces (
  id    TEXT PRIMARY KEY,
  owner TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ns              TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  description     TEXT    NOT NULL DEFAULT '',
  long_desc       TEXT    NOT NULL DEFAULT '',
  icon            TEXT    NOT NULL DEFAULT '?',
  icon_class      TEXT    NOT NULL DEFAULT 'blue',
  classification  TEXT    NOT NULL DEFAULT 'L2',
  status          TEXT    NOT NULL DEFAULT 'draft',
  version         TEXT    NOT NULL DEFAULT '0.1.0',
  author          TEXT    NOT NULL,
  rating          REAL    NOT NULL DEFAULT 0,
  ratings_count   INTEGER NOT NULL DEFAULT 0,
  ratings_sum     INTEGER NOT NULL DEFAULT 0,
  activations     INTEGER NOT NULL DEFAULT 0,
  delta_pct       INTEGER NOT NULL DEFAULT 0,
  hot             INTEGER NOT NULL DEFAULT 0,
  tags_csv        TEXT    NOT NULL DEFAULT '',
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ns, name)
);
CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status);
CREATE INDEX IF NOT EXISTS idx_skills_ns     ON skills(ns);

CREATE TABLE IF NOT EXISTS reviews (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ns              TEXT    NOT NULL,
  skill_name      TEXT    NOT NULL,
  version         TEXT    NOT NULL,
  classification  TEXT    NOT NULL,
  author          TEXT    NOT NULL,
  reviewers_csv   TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'pending',
  urgency         TEXT    NOT NULL DEFAULT 'ok',
  sla             TEXT    NOT NULL DEFAULT '72h',
  note            TEXT    NOT NULL DEFAULT '',
  submitted_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at      DATETIME
);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id   INTEGER NOT NULL,
  author      TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_comments_review ON comments(review_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor       TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  target      TEXT    NOT NULL DEFAULT '',
  version     TEXT    NOT NULL DEFAULT '',
  ip          TEXT    NOT NULL DEFAULT '',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user        TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  target_kind TEXT    NOT NULL DEFAULT '',
  target_ref  TEXT    NOT NULL DEFAULT '',
  body        TEXT    NOT NULL,
  unread      INTEGER NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user);

CREATE TABLE IF NOT EXISTS skill_ratings (
  skill_id    INTEGER NOT NULL,
  username    TEXT    NOT NULL,
  stars       INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  comment     TEXT    NOT NULL DEFAULT '',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (skill_id, username),
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ratings_skill ON skill_ratings(skill_id);

CREATE TABLE IF NOT EXISTS namespace_members (
  ns        TEXT NOT NULL,
  username  TEXT NOT NULL,
  ns_role   TEXT NOT NULL DEFAULT 'member', -- owner|maintainer|reviewer|member
  PRIMARY KEY (ns, username)
);
CREATE INDEX IF NOT EXISTS idx_nsm_user ON namespace_members(username);
CREATE INDEX IF NOT EXISTS idx_nsm_role ON namespace_members(ns, ns_role);

CREATE TABLE IF NOT EXISTS skill_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ns          TEXT NOT NULL,
  name        TEXT NOT NULL,
  version     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft', -- draft|review|approved|rejected|published|changes_requested
  author      TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  review_id   INTEGER NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_skill_versions ON skill_versions(ns, name);

CREATE TABLE IF NOT EXISTS skill_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ns          TEXT    NOT NULL,
  skill_name  TEXT    NOT NULL,
  path        TEXT    NOT NULL,
  content     TEXT    NOT NULL DEFAULT '',
  size        INTEGER NOT NULL DEFAULT 0,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by  TEXT    NOT NULL DEFAULT '',
  UNIQUE (ns, skill_name, path)
);
CREATE INDEX IF NOT EXISTS idx_skill_files_skill ON skill_files(ns, skill_name);

-- review_files: snapshot of every file the author submitted for review,
-- together with the file body from the previous approved review (if any) so
-- the diff view doesn't have to walk history.
--   change_kind ∈ added | modified | deleted | unchanged
-- Snapshots are immutable: the same (review_id, path) row is written once
-- when the author hits "submit", then read back by reviewers.
CREATE TABLE IF NOT EXISTS review_files (
  review_id    INTEGER NOT NULL,
  path         TEXT    NOT NULL,
  base_content TEXT    NOT NULL DEFAULT '',
  new_content  TEXT    NOT NULL DEFAULT '',
  change_kind  TEXT    NOT NULL DEFAULT 'modified',
  PRIMARY KEY (review_id, path),
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_review_files_review ON review_files(review_id);
`
