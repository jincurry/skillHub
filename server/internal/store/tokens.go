package store

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/jincurry/skillhub/server/internal/model"
)

const tokenPrefix = "skillhub_"

func hashToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

// GenerateRawToken returns a new raw PAT (never stored).
func GenerateRawToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return tokenPrefix + hex.EncodeToString(b), nil
}

// CreateAPIToken mints a new PAT for the user and stores its hash.
// Returns the raw token (shown once) and the stored record.
func (s *Store) CreateAPIToken(username string, req model.CreateAPITokenRequest) (string, *model.APIToken, error) {
	raw, err := GenerateRawToken()
	if err != nil {
		return "", nil, fmt.Errorf("generate token: %w", err)
	}
	hash := hashToken(raw)

	var expiresAt *time.Time
	switch req.ExpiresIn {
	case "30d":
		t := time.Now().UTC().AddDate(0, 0, 30)
		expiresAt = &t
	case "90d":
		t := time.Now().UTC().AddDate(0, 0, 90)
		expiresAt = &t
	case "365d":
		t := time.Now().UTC().AddDate(1, 0, 0)
		expiresAt = &t
	}

	var res interface {
		LastInsertId() (int64, error)
	}
	if expiresAt != nil {
		res, err = s.DB.Exec(
			`INSERT INTO api_tokens(name,token_hash,username,expires_at) VALUES(?,?,?,?)`,
			req.Name, hash, username, expiresAt.Format(time.RFC3339),
		)
	} else {
		res, err = s.DB.Exec(
			`INSERT INTO api_tokens(name,token_hash,username) VALUES(?,?,?)`,
			req.Name, hash, username,
		)
	}
	if err != nil {
		return "", nil, err
	}
	id, _ := res.(interface{ LastInsertId() (int64, error) }).LastInsertId()
	tok := &model.APIToken{
		ID:        id,
		Name:      req.Name,
		Username:  username,
		CreatedAt: time.Now().UTC(),
		ExpiresAt: expiresAt,
	}
	return raw, tok, nil
}

// ListAPITokens returns all tokens owned by the user (hash omitted).
func (s *Store) ListAPITokens(username string) ([]model.APIToken, error) {
	rows, err := s.DB.Query(
		`SELECT id,name,username,created_at,expires_at,last_used FROM api_tokens WHERE username=? ORDER BY created_at DESC`,
		username,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.APIToken
	for rows.Next() {
		var t model.APIToken
		var exp, used sql.NullString
		if err := rows.Scan(&t.ID, &t.Name, &t.Username, &t.CreatedAt, &exp, &used); err != nil {
			return nil, err
		}
		if exp.Valid {
			parsed, _ := time.Parse(time.RFC3339, exp.String)
			t.ExpiresAt = &parsed
		}
		if used.Valid {
			parsed, _ := time.Parse(time.RFC3339, used.String)
			t.LastUsed = &parsed
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// DeleteAPIToken removes a token by ID, enforcing ownership.
func (s *Store) DeleteAPIToken(id int64, username string) error {
	res, err := s.DB.Exec(`DELETE FROM api_tokens WHERE id=? AND username=?`, id, username)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("token not found or not owned by %s", username)
	}
	return nil
}

// LookupTokenUser validates a raw PAT and returns the owning username.
// Updates last_used on success. Returns "" if the token is invalid or expired.
func (s *Store) LookupTokenUser(raw string) (string, error) {
	hash := hashToken(raw)
	var username, expiresAt string
	var expired sql.NullString
	err := s.DB.QueryRow(
		`SELECT username, COALESCE(expires_at,'') FROM api_tokens WHERE token_hash=?`, hash,
	).Scan(&username, &expiresAt)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	_ = expired
	if expiresAt != "" {
		t, err := time.Parse(time.RFC3339, expiresAt)
		if err == nil && time.Now().UTC().After(t) {
			return "", nil // expired
		}
	}
	_, _ = s.DB.Exec(`UPDATE api_tokens SET last_used=CURRENT_TIMESTAMP WHERE token_hash=?`, hash)
	return username, nil
}
