package store

import (
	"database/sql"

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
	if err := tx.QueryRow(`SELECT id FROM skills WHERE ns=? AND name=?`, ns, name).Scan(&skillID); err != nil {
		return nil, err
	}
	var skillAuthor string
	_ = tx.QueryRow(`SELECT author FROM skills WHERE id=?`, skillID).Scan(&skillAuthor)

	var prev int
	row := tx.QueryRow(`SELECT stars FROM skill_ratings WHERE skill_id=? AND username=?`, skillID, username)
	switch err := row.Scan(&prev); err {
	case nil:
		// update existing
		if _, err := tx.Exec(`UPDATE skill_ratings SET stars=?, comment=?, created_at=CURRENT_TIMESTAMP WHERE skill_id=? AND username=?`,
			stars, comment, skillID, username); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(`UPDATE skills SET ratings_sum = ratings_sum - ? + ?, rating = CAST(ratings_sum - ? + ? AS REAL)/ratings_count
			WHERE id=? AND ratings_count > 0`, prev, stars, prev, stars, skillID); err != nil {
			return nil, err
		}
	case sql.ErrNoRows:
		if _, err := tx.Exec(`INSERT INTO skill_ratings(skill_id,username,stars,comment) VALUES(?,?,?,?)`,
			skillID, username, stars, comment); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(`UPDATE skills SET ratings_sum = ratings_sum + ?, ratings_count = ratings_count + 1,
			rating = CAST(ratings_sum + ? AS REAL)/(ratings_count + 1) WHERE id=?`,
			stars, stars, skillID); err != nil {
			return nil, err
		}
	default:
		return nil, err
	}
	if _, err := tx.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		username, "rate_skill", ns+"/"+name, "", "127.0.0.1"); err != nil {
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
