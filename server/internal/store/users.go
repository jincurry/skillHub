package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/jincurry/skillhub/server/internal/auth"
	"github.com/jincurry/skillhub/server/internal/model"
)

func (s *Store) ListAdminUsers() ([]model.AdminUser, error) {
	rows, err := s.DB.Query(`
		SELECT username,
		       COALESCE(display,''),
		       COALESCE(role,''),
		       COALESCE(team,''),
		       COALESCE(email,''),
		       COALESCE(is_admin,0),
		       COALESCE(is_disabled,0),
		       joined_at
		FROM users
		ORDER BY joined_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.AdminUser
	for rows.Next() {
		var u model.AdminUser
		var isAdmin, isDisabled int
		var joinedAt time.Time
		if err := rows.Scan(&u.Username, &u.Display, &u.Role, &u.Team,
			&u.Email, &isAdmin, &isDisabled, &joinedAt); err != nil {
			return nil, err
		}
		u.IsAdmin = isAdmin == 1
		u.IsDisabled = isDisabled == 1
		u.JoinedAt = joinedAt
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) CreateAdminUser(req model.CreateUserRequest) error {
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" {
		return errors.New("username is required")
	}
	display := strings.TrimSpace(req.Display)
	if display == "" {
		display = req.Username
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		return err
	}
	isAdmin := 0
	if req.IsAdmin {
		isAdmin = 1
	}
	_, err = s.DB.Exec(`
		INSERT INTO users(username, display, role, team, email, password_hash, is_admin, joined_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
		req.Username, display, req.Role, req.Team, req.Email, hash, isAdmin)
	return err
}

func (s *Store) AdminUpdateUser(username string, req model.AdminUpdateUserRequest) (*model.AdminUser, error) {
	sets := []string{}
	args := []any{}
	if req.Display != nil {
		sets = append(sets, "display = ?")
		args = append(args, strings.TrimSpace(*req.Display))
	}
	if req.Role != nil {
		sets = append(sets, "role = ?")
		args = append(args, strings.TrimSpace(*req.Role))
	}
	if req.Team != nil {
		sets = append(sets, "team = ?")
		args = append(args, strings.TrimSpace(*req.Team))
	}
	if req.Email != nil {
		sets = append(sets, "email = ?")
		args = append(args, strings.TrimSpace(*req.Email))
	}
	if req.IsAdmin != nil {
		v := 0
		if *req.IsAdmin {
			v = 1
		}
		sets = append(sets, "is_admin = ?")
		args = append(args, v)
	}
	if req.IsDisabled != nil {
		v := 0
		if *req.IsDisabled {
			v = 1
		}
		sets = append(sets, "is_disabled = ?")
		args = append(args, v)
	}
	if req.Password != nil && *req.Password != "" {
		if len(*req.Password) < 6 {
			return nil, errors.New("password must be at least 6 characters")
		}
		hash, err := auth.HashPassword(*req.Password)
		if err != nil {
			return nil, err
		}
		sets = append(sets, "password_hash = ?")
		args = append(args, hash)
	}
	if len(sets) == 0 {
		return s.GetAdminUser(username)
	}
	args = append(args, username)
	if _, err := s.DB.Exec("UPDATE users SET "+strings.Join(sets, ", ")+" WHERE username = ?", args...); err != nil {
		return nil, err
	}
	return s.GetAdminUser(username)
}

func (s *Store) GetAdminUser(username string) (*model.AdminUser, error) {
	row := s.DB.QueryRow(`
		SELECT username,
		       COALESCE(display,''),
		       COALESCE(role,''),
		       COALESCE(team,''),
		       COALESCE(email,''),
		       COALESCE(is_admin,0),
		       COALESCE(is_disabled,0),
		       joined_at
		FROM users WHERE username = ?`, username)
	var u model.AdminUser
	var isAdmin, isDisabled int
	if err := row.Scan(&u.Username, &u.Display, &u.Role, &u.Team,
		&u.Email, &isAdmin, &isDisabled, &u.JoinedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("user not found")
		}
		return nil, err
	}
	u.IsAdmin = isAdmin == 1
	u.IsDisabled = isDisabled == 1
	return &u, nil
}

// RegisterUser creates a brand new account for self-service signup. The very
// first account created on an empty users table is promoted to admin so the
// install has someone who can configure AI providers, namespaces, and policies
// out of the box.
func (s *Store) RegisterUser(username, password, display, email string) (*model.Me, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return nil, errors.New("username is required")
	}
	if len(password) < 6 {
		return nil, errors.New("password must be at least 6 characters")
	}
	display = strings.TrimSpace(display)
	if display == "" {
		display = username
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return nil, err
	}

	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var existing int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM users WHERE username = ?`, username).Scan(&existing); err != nil {
		return nil, err
	}
	if existing > 0 {
		return nil, errors.New("username already taken")
	}

	var total int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&total); err != nil {
		return nil, err
	}
	isAdmin := 0
	role := "Member"
	if total == 0 {
		isAdmin = 1
		role = "Maintainer"
	}

	if _, err := tx.Exec(`
		INSERT INTO users(username, display, role, team, email, password_hash, is_admin, joined_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
		username, display, role, "", strings.TrimSpace(email), hash, isAdmin); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetUser(username)
}

// IsUserDisabled reports whether the user has is_disabled=1.
// Used by the login handler to block disabled accounts.
func (s *Store) IsUserDisabled(username string) (bool, error) {
	var v int
	err := s.DB.QueryRow(`SELECT COALESCE(is_disabled,0) FROM users WHERE username=?`, username).Scan(&v)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return v == 1, err
}
