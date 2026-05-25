-- Blob object index. Content lives on the filesystem (or object storage);
-- this table holds metadata and the ref_count used by GC.
CREATE TABLE IF NOT EXISTS blob_objects (
    sha256      CHAR(64) PRIMARY KEY,
    size        INTEGER  NOT NULL,
    is_chunked  INTEGER  NOT NULL DEFAULT 0,
    ref_count   INTEGER  NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Chunk manifest for assembled large-file blobs.
CREATE TABLE IF NOT EXISTS blob_chunks (
    parent_sha256 CHAR(64) NOT NULL REFERENCES blob_objects(sha256),
    chunk_index   INTEGER  NOT NULL,
    chunk_sha256  CHAR(64) NOT NULL,
    chunk_size    INTEGER  NOT NULL,
    PRIMARY KEY (parent_sha256, chunk_index)
);

-- In-progress chunked upload sessions. Rows are deleted on complete or expiry.
CREATE TABLE IF NOT EXISTS blob_uploads (
    upload_id   TEXT     PRIMARY KEY,
    sha256      CHAR(64) NOT NULL,
    expires_at  DATETIME NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS blob_upload_chunks (
    upload_id    TEXT     NOT NULL REFERENCES blob_uploads(upload_id) ON DELETE CASCADE,
    chunk_index  INTEGER  NOT NULL,
    chunk_sha256 CHAR(64) NOT NULL,
    PRIMARY KEY (upload_id, chunk_index)
);

-- Tree snapshots: a deterministic hash over a sorted (path, sha256) set.
-- One row per unique file-tree state; skill versions reference these.
CREATE TABLE IF NOT EXISTS skill_trees (
    tree_hash  CHAR(64) PRIMARY KEY,
    manifest   TEXT     NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- skill_files: add blob reference (nullable; old inline rows keep content='').
ALTER TABLE skill_files ADD COLUMN blob_hash CHAR(64);

-- skills: track the current draft tree for optimistic concurrency control.
ALTER TABLE skills ADD COLUMN draft_tree_hash CHAR(64);
ALTER TABLE skills ADD COLUMN draft_seq       INTEGER NOT NULL DEFAULT 0;
