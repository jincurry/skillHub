package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jincurry/skillhub/server/internal/auth"
	"github.com/jincurry/skillhub/server/internal/model"
)

// scanAIProvider centralises the SELECT projection used by every query so the
// column order can't drift. is_admin-style fields (enabled / is_default) are
// scanned as int and converted to bool afterwards.
const aiProviderColumns = `id, name, base_url, model, COALESCE(api_key_enc,''), enabled, is_default, created_at, updated_at`

func scanAIProvider(row interface {
	Scan(...any) error
}) (*model.AIProvider, string, error) {
	var p model.AIProvider
	var enabled, isDefault int
	var enc string
	if err := row.Scan(&p.ID, &p.Name, &p.BaseURL, &p.Model, &enc,
		&enabled, &isDefault, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, "", err
	}
	p.Enabled = enabled == 1
	p.IsDefault = isDefault == 1
	p.HasKey = enc != ""
	return &p, enc, nil
}

// ListAIProviders returns the admin-facing list (no key material). Sorted by
// is_default DESC, id ASC so the default row floats to the top of the table.
func (s *Store) ListAIProviders() ([]model.AIProvider, error) {
	rows, err := s.DB.Query(`SELECT ` + aiProviderColumns + ` FROM ai_providers ORDER BY is_default DESC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.AIProvider{}
	for rows.Next() {
		p, _, err := scanAIProvider(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// ListAIProviderRefs is what regular (non-admin) editors see. We only return
// providers that are enabled — disabling a row temporarily takes it off the
// editor dropdown without losing its config.
func (s *Store) ListAIProviderRefs() ([]model.AIProviderRef, error) {
	rows, err := s.DB.Query(`SELECT id, name, model, is_default
		FROM ai_providers WHERE enabled = 1
		ORDER BY is_default DESC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.AIProviderRef{}
	for rows.Next() {
		var r model.AIProviderRef
		var isDefault int
		if err := rows.Scan(&r.ID, &r.Name, &r.Model, &isDefault); err != nil {
			return nil, err
		}
		r.IsDefault = isDefault == 1
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetAIProvider fetches the metadata only (HasKey, no plaintext key).
func (s *Store) GetAIProvider(id int64) (*model.AIProvider, error) {
	row := s.DB.QueryRow(`SELECT `+aiProviderColumns+` FROM ai_providers WHERE id = ?`, id)
	p, _, err := scanAIProvider(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return p, nil
}

// GetAIProviderForUse is the call path for the assist endpoint: returns the
// provider and the *decrypted* API key. Callers must keep the returned key in
// memory only and never echo it back to clients.
func (s *Store) GetAIProviderForUse(id int64, masterSecret []byte) (*model.AIProvider, string, error) {
	row := s.DB.QueryRow(`SELECT `+aiProviderColumns+` FROM ai_providers WHERE id = ? AND enabled = 1`, id)
	p, enc, err := scanAIProvider(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, "", nil
		}
		return nil, "", err
	}
	key, err := auth.DecryptSecret(masterSecret, enc)
	if err != nil {
		return nil, "", fmt.Errorf("decrypt api key: %w", err)
	}
	return p, key, nil
}

// CreateAIProvider inserts a new row, encrypting the supplied API key. If
// IsDefault is true, any existing default flag is cleared first inside the
// same transaction.
func (s *Store) CreateAIProvider(req model.CreateAIProviderRequest, masterSecret []byte) (*model.AIProvider, error) {
	name := strings.TrimSpace(req.Name)
	baseURL := strings.TrimRight(strings.TrimSpace(req.BaseURL), "/")
	mdl := strings.TrimSpace(req.Model)
	if name == "" || baseURL == "" || mdl == "" {
		return nil, errors.New("name, baseUrl and model are required")
	}
	enc, err := auth.EncryptSecret(masterSecret, req.APIKey)
	if err != nil {
		return nil, fmt.Errorf("encrypt api key: %w", err)
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if req.IsDefault {
		if _, err := tx.Exec(`UPDATE ai_providers SET is_default = 0`); err != nil {
			return nil, err
		}
	}
	res, err := tx.Exec(`INSERT INTO ai_providers(name, base_url, model, api_key_enc, enabled, is_default)
		VALUES(?,?,?,?,?,?)`,
		name, baseURL, mdl, enc, boolToInt(req.Enabled), boolToInt(req.IsDefault))
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetAIProvider(id)
}

// UpdateAIProvider applies a partial update. APIKey == nil means "keep existing"
// while pointing it to the empty string would clear the key — we reject the
// latter so a provider can't be left in a half-configured state.
func (s *Store) UpdateAIProvider(id int64, req model.UpdateAIProviderRequest, masterSecret []byte) (*model.AIProvider, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	sets := []string{}
	args := []any{}
	if req.Name != nil {
		sets = append(sets, "name = ?")
		args = append(args, strings.TrimSpace(*req.Name))
	}
	if req.BaseURL != nil {
		sets = append(sets, "base_url = ?")
		args = append(args, strings.TrimRight(strings.TrimSpace(*req.BaseURL), "/"))
	}
	if req.Model != nil {
		sets = append(sets, "model = ?")
		args = append(args, strings.TrimSpace(*req.Model))
	}
	if req.APIKey != nil {
		key := strings.TrimSpace(*req.APIKey)
		if key == "" {
			return nil, errors.New("apiKey cannot be cleared; omit the field to keep the existing key")
		}
		enc, err := auth.EncryptSecret(masterSecret, key)
		if err != nil {
			return nil, fmt.Errorf("encrypt api key: %w", err)
		}
		sets = append(sets, "api_key_enc = ?")
		args = append(args, enc)
	}
	if req.Enabled != nil {
		sets = append(sets, "enabled = ?")
		args = append(args, boolToInt(*req.Enabled))
	}
	if req.IsDefault != nil {
		if *req.IsDefault {
			// Only one default at a time.
			if _, err := tx.Exec(`UPDATE ai_providers SET is_default = 0 WHERE id <> ?`, id); err != nil {
				return nil, err
			}
		}
		sets = append(sets, "is_default = ?")
		args = append(args, boolToInt(*req.IsDefault))
	}
	if len(sets) == 0 {
		// No-op update; just return the current row.
		return s.GetAIProvider(id)
	}
	sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, id)
	q := "UPDATE ai_providers SET " + strings.Join(sets, ", ") + " WHERE id = ?"
	res, err := tx.Exec(q, args...)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, errors.New("provider not found")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetAIProvider(id)
}

func (s *Store) DeleteAIProvider(id int64) error {
	res, err := s.DB.Exec(`DELETE FROM ai_providers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errors.New("provider not found")
	}
	return nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
