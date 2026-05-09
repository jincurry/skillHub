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
  joined_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
`
