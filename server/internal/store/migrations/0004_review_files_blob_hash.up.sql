-- review_files: track blob references for files stored via the push protocol.
-- For inline (text) files these columns stay empty/zero and {base,new}_content
-- holds the body as before. For blob files, the corresponding _content stays
-- empty and {base,new}_blob_hash points at a live blob object — bundle /
-- rollback / diff paths must consult both columns. _size is captured for
-- blob files so the UI / rollback can bump ref_count without a blob_objects
-- round-trip.
ALTER TABLE review_files ADD COLUMN base_blob_hash CHAR(64) NOT NULL DEFAULT '';
ALTER TABLE review_files ADD COLUMN new_blob_hash  CHAR(64) NOT NULL DEFAULT '';
ALTER TABLE review_files ADD COLUMN base_size      INTEGER  NOT NULL DEFAULT 0;
ALTER TABLE review_files ADD COLUMN new_size       INTEGER  NOT NULL DEFAULT 0;
