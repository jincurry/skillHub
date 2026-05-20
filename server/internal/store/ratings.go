package store

import (
	"github.com/jincurry/skillhub/server/internal/audit"
	"github.com/jincurry/skillhub/server/internal/model"
)

// RateSkill upserts a rating from username for a skill. Returns updated summary.
func (s *Store) RateSkill(ns, name, username string, stars int, comment string) (*model.RatingSummary, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var skillID int64
	var skillAuthor string
	if err := tx.QueryRow(`SELECT id, author FROM skills WHERE ns=? AND name=?`, ns, name).
		Scan(&skillID, &skillAuthor); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(`
		INSERT INTO skill_ratings(skill_id, username, stars, comment)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(skill_id, username) DO UPDATE SET
			stars      = excluded.stars,
			comment    = excluded.comment,
			created_at = CURRENT_TIMESTAMP`,
		skillID, username, stars, comment); err != nil {
		return nil, err
	}

	// Recompute aggregates from the source of truth rather than maintaining
	// incremental deltas across insert vs update branches.
	if _, err := tx.Exec(`
		UPDATE skills SET
			ratings_count = (SELECT COUNT(*)                FROM skill_ratings WHERE skill_id = ?),
			ratings_sum   = (SELECT COALESCE(SUM(stars), 0) FROM skill_ratings WHERE skill_id = ?),
			rating        = COALESCE((SELECT AVG(CAST(stars AS REAL)) FROM skill_ratings WHERE skill_id = ?), 0)
		WHERE id = ?`,
		skillID, skillID, skillID, skillID); err != nil {
		return nil, err
	}

	if err := audit.LogTx(tx, username, "rate_skill", ns+"/"+name, "", ""); err != nil {
		return nil, err
	}
	if skillAuthor != "" && skillAuthor != username {
		body := "@" + username + " 给你的 " + ns + "/" + name + " 打了 " + starsLabel(stars) + " 星"
		if comment != "" {
			body += "：" + comment
		}
		if _, err := tx.Exec(`INSERT INTO notifications(user,kind,body) VALUES(?,?,?)`,
			skillAuthor, "rating", body); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.RatingSummary(ns, name, username)
}

func starsLabel(n int) string {
	switch n {
	case 1:
		return "1"
	case 2:
		return "2"
	case 3:
		return "3"
	case 4:
		return "4"
	case 5:
		return "5"
	default:
		return "?"
	}
}

// RatingSummary returns aggregate stats for a skill, plus the calling user's own stars (0 if none).
func (s *Store) RatingSummary(ns, name, username string) (*model.RatingSummary, error) {
	row := s.DB.QueryRow(`SELECT rating, ratings_count FROM skills WHERE ns=? AND name=?`, ns, name)
	var sum model.RatingSummary
	if err := row.Scan(&sum.Average, &sum.Count); err != nil {
		return nil, err
	}
	if username != "" {
		var mine int
		err := s.DB.QueryRow(`SELECT stars FROM skill_ratings sr JOIN skills s ON s.id=sr.skill_id
			WHERE s.ns=? AND s.name=? AND sr.username=?`, ns, name, username).Scan(&mine)
		if err == nil {
			sum.Mine = mine
		}
	}
	return &sum, nil
}

// ListRatings returns recent comment ratings for a skill (newest first, limit 50).
func (s *Store) ListRatings(ns, name string) ([]model.Rating, error) {
	rows, err := s.DB.Query(`SELECT sr.username, sr.stars, sr.comment, sr.created_at
		FROM skill_ratings sr
		JOIN skills s ON s.id = sr.skill_id
		WHERE s.ns=? AND s.name=?
		ORDER BY sr.created_at DESC LIMIT 50`, ns, name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Rating
	for rows.Next() {
		var r model.Rating
		if err := rows.Scan(&r.Username, &r.Stars, &r.Comment, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
