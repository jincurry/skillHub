package store

import "github.com/jincurry/skillhub/server/internal/model"

// ListSkillVersions returns the version history for a skill, newest first.
func (s *Store) ListSkillVersions(ns, name string) ([]model.SkillVersion, error) {
	rows, err := s.DB.Query(`SELECT id,ns,name,version,status,author,note,review_id,created_at,updated_at
		FROM skill_versions WHERE ns=? AND name=? ORDER BY created_at DESC`, ns, name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.SkillVersion
	for rows.Next() {
		var v model.SkillVersion
		if err := rows.Scan(&v.ID, &v.Namespace, &v.Name, &v.Version, &v.Status, &v.Author,
			&v.Note, &v.ReviewID, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
