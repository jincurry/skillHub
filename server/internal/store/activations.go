package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

const maxActivationCount = 1000

// RecordActivation increments a skill's activation counter by count (capped
// at maxActivationCount) and upserts today's row in skill_daily_metrics.
// After the write it recomputes delta_pct and hot from the last 14 days so
// the Browse rankings stay live without a separate cron job.
func (s *Store) RecordActivation(ns, name string, count int) (totalActivations int, err error) {
	if count <= 0 {
		count = 1
	}
	if count > maxActivationCount {
		count = maxActivationCount
	}

	// Verify the skill exists first so we return a clean 404 message.
	var exists int
	if err := s.DB.QueryRow(`SELECT 1 FROM skills WHERE ns=? AND name=?`, ns, name).Scan(&exists); err != nil {
		if err == sql.ErrNoRows {
			return 0, errors.New("skill not found")
		}
		return 0, err
	}

	tx, err := s.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	// Increment the total counter and read back the new value.
	if _, err := tx.Exec(
		`UPDATE skills SET activations = activations + ? WHERE ns=? AND name=?`,
		count, ns, name,
	); err != nil {
		return 0, err
	}
	if err := tx.QueryRow(`SELECT activations FROM skills WHERE ns=? AND name=?`, ns, name).Scan(&totalActivations); err != nil {
		return 0, err
	}

	// Upsert today's daily_metrics row.
	today := time.Now().UTC().Format("2006-01-02")
	if _, err := tx.Exec(`
		INSERT INTO skill_daily_metrics(ns, name, day, activations)
		VALUES(?, ?, ?, ?)
		ON CONFLICT(ns, name, day) DO UPDATE SET activations = activations + ?`,
		ns, name, today, count, count,
	); err != nil {
		return 0, err
	}

	// Recompute delta_pct and hot from the last 14 days in this transaction.
	delta, hot, calcErr := calcDelta(tx, ns, name)
	if calcErr == nil {
		hotInt := 0
		if hot {
			hotInt = 1
		}
		if _, err := tx.Exec(
			`UPDATE skills SET delta_pct=?, hot=? WHERE ns=? AND name=?`,
			delta, hotInt, ns, name,
		); err != nil {
			return 0, err
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return totalActivations, nil
}

// calcDelta sums the last 7 days vs the preceding 7 days from skill_daily_metrics
// and returns the percentage change and whether the skill is "hot" (delta > 20%).
func calcDelta(tx interface {
	QueryRow(string, ...any) *sql.Row
}, ns, name string) (deltaPct int, hot bool, err error) {
	cutoff14 := time.Now().UTC().AddDate(0, 0, -13).Format("2006-01-02")
	cutoff7 := time.Now().UTC().AddDate(0, 0, -6).Format("2006-01-02")

	var recent, prev sql.NullInt64
	err = tx.QueryRow(`
		SELECT
			SUM(CASE WHEN day >= ? THEN activations ELSE 0 END),
			SUM(CASE WHEN day < ?  THEN activations ELSE 0 END)
		FROM skill_daily_metrics
		WHERE ns=? AND name=? AND day >= ?`,
		cutoff7, cutoff7, ns, name, cutoff14,
	).Scan(&recent, &prev)
	if err != nil {
		return 0, false, fmt.Errorf("calcDelta: %w", err)
	}

	r := recent.Int64
	p := prev.Int64
	switch {
	case p == 0 && r > 0:
		deltaPct = 100
	case p == 0:
		deltaPct = 0
	default:
		deltaPct = int((r - p) * 100 / p)
	}
	hot = deltaPct > 20
	return deltaPct, hot, nil
}
