package store

import (
	"database/sql"

	"github.com/jincurry/skillhub/server/internal/model"
)

// Subscribe registers `user`'s interest in publish events for ns/name.
// Idempotent — a second call from the same user is a silent no-op.
func (s *Store) Subscribe(user, ns, name string) error {
	_, err := s.DB.Exec(`
		INSERT INTO subscriptions(username, ns, skill_name)
		VALUES(?,?,?)
		ON CONFLICT(username, ns, skill_name) DO NOTHING`,
		user, ns, name)
	return err
}

// Unsubscribe removes the row; missing row is not an error.
func (s *Store) Unsubscribe(user, ns, name string) error {
	_, err := s.DB.Exec(`DELETE FROM subscriptions WHERE username=? AND ns=? AND skill_name=?`,
		user, ns, name)
	return err
}

// IsSubscribed reports whether user is following the given skill.
func (s *Store) IsSubscribed(user, ns, name string) (bool, error) {
	var n int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM subscriptions WHERE username=? AND ns=? AND skill_name=?`,
		user, ns, name).Scan(&n)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return n > 0, err
}

// CountSubscribers returns how many users are following the given skill.
// Used for the SkillDetail "N 关注" chip.
func (s *Store) CountSubscribers(ns, name string) (int, error) {
	var n int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM subscriptions WHERE ns=? AND skill_name=?`,
		ns, name).Scan(&n)
	return n, err
}

// ListMySubscriptions returns the skills `user` follows, newest first.
func (s *Store) ListMySubscriptions(user string) ([]model.Subscription, error) {
	rows, err := s.DB.Query(`
		SELECT ns, skill_name, created_at
		  FROM subscriptions
		 WHERE username = ?
		 ORDER BY created_at DESC`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]model.Subscription, 0)
	for rows.Next() {
		var sub model.Subscription
		if err := rows.Scan(&sub.Namespace, &sub.SkillName, &sub.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, sub)
	}
	return out, rows.Err()
}

// fanOutPublishNotifTx writes one in-app notification per subscriber when a
// new version of (ns, name) is published. The author and the actor (the
// reviewer who approved) are excluded — they don't need to hear about
// their own publish. Runs inside the existing DecideReview transaction so
// either everything commits or nothing does.
func fanOutPublishNotifTx(tx *sql.Tx, ns, name, version, author, actor string) error {
	rows, err := tx.Query(`SELECT username FROM subscriptions WHERE ns=? AND skill_name=?`, ns, name)
	if err != nil {
		return err
	}
	defer rows.Close()
	body := "你关注的 " + ns + "/" + name + " 发布了 v" + version
	for rows.Next() {
		var u string
		if err := rows.Scan(&u); err != nil {
			return err
		}
		if u == author || u == actor {
			continue
		}
		if _, err := tx.Exec(
			`INSERT INTO notifications(user,kind,target_kind,target_ref,body) VALUES(?,?,?,?,?)`,
			u, "publish", "skill", ns+"/"+name, body); err != nil {
			return err
		}
	}
	return rows.Err()
}
