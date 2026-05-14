package store

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/jincurry/skillhub/server/internal/model"
)

// ListDistTags returns every (tag → version) pointer for a skill, ordered
// with the conventional channels first (latest, stable, beta) then any
// custom tags alphabetically. Empty slice if the skill has none.
func (s *Store) ListDistTags(ns, name string) ([]model.DistTag, error) {
	rows, err := s.DB.Query(`
		SELECT tag, version, updated_at, updated_by
		  FROM skill_dist_tags
		 WHERE ns = ? AND skill_name = ?
		 ORDER BY CASE tag
		     WHEN 'latest' THEN 0
		     WHEN 'stable' THEN 1
		     WHEN 'beta'   THEN 2
		     ELSE 3
		   END, tag`, ns, name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.DistTag
	for rows.Next() {
		var t model.DistTag
		if err := rows.Scan(&t.Tag, &t.Version, &t.UpdatedAt, &t.UpdatedBy); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// SetDistTag points `tag` at `version` for the given skill. The version must
// already exist in skill_versions (any status is fine — pointing latest at a
// rejected build would be silly but we leave that policy to the caller).
// `actor` is recorded for audit.
func (s *Store) SetDistTag(ns, name, tag, version, actor string) error {
	if tag == "" {
		return errors.New("tag is required")
	}
	if version == "" {
		return errors.New("version is required")
	}
	var n int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM skill_versions WHERE ns=? AND name=? AND version=?`,
		ns, name, version).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("version %s not found for %s/%s", version, ns, name)
	}
	_, err := s.DB.Exec(`
		INSERT INTO skill_dist_tags(ns, skill_name, tag, version, updated_by)
		VALUES(?,?,?,?,?)
		ON CONFLICT(ns, skill_name, tag) DO UPDATE SET
			version    = excluded.version,
			updated_by = excluded.updated_by,
			updated_at = CURRENT_TIMESTAMP`,
		ns, name, tag, version, actor)
	return err
}

// DeleteDistTag removes the alias. We protect "latest" because the publish
// flow auto-manages it; deleting it leaves the chip flickering on the next
// publish anyway.
func (s *Store) DeleteDistTag(ns, name, tag string) error {
	if tag == "latest" {
		return errors.New("cannot delete the auto-managed 'latest' tag")
	}
	res, err := s.DB.Exec(`DELETE FROM skill_dist_tags WHERE ns=? AND skill_name=? AND tag=?`, ns, name, tag)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ResolveDistTag maps a tag string (e.g. "latest") to the version it
// points at. Returns sql.ErrNoRows if the alias doesn't exist; callers
// typically translate that into a 404.
func (s *Store) ResolveDistTag(ns, name, tag string) (string, error) {
	var v string
	err := s.DB.QueryRow(
		`SELECT version FROM skill_dist_tags WHERE ns=? AND skill_name=? AND tag=?`,
		ns, name, tag,
	).Scan(&v)
	return v, err
}

// upsertDistTagTx is the in-transaction variant used by DecideReview to
// auto-bump "latest" on publish without grabbing a second connection (we
// run with SetMaxOpenConns(1)).
func upsertDistTagTx(tx *sql.Tx, ns, name, tag, version, actor string) error {
	_, err := tx.Exec(`
		INSERT INTO skill_dist_tags(ns, skill_name, tag, version, updated_by)
		VALUES(?,?,?,?,?)
		ON CONFLICT(ns, skill_name, tag) DO UPDATE SET
			version    = excluded.version,
			updated_by = excluded.updated_by,
			updated_at = CURRENT_TIMESTAMP`,
		ns, name, tag, version, actor)
	return err
}
