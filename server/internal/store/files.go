package store

import (
	"database/sql"
	"errors"
	"path"
	"regexp"
	"strings"

	"github.com/jincurry/skillhub/server/internal/model"
)

// MaxFileBytes caps a single file at 1 MiB. The bundle (sum of all files) is
// not enforced here — the validate package can add that as a check.
const MaxFileBytes = 1 << 20

// validPathSegment enforces conservative file/directory names. We deliberately
// reject leading dots so dotfiles can't sneak in (`.env`, `.git`, ...).
var validPathSegment = regexp.MustCompile(`^[A-Za-z0-9_-][A-Za-z0-9_.-]*$`)

// ValidateFilePath returns the cleaned path on success or an error explaining
// what's wrong. Path rules:
//   - 1..200 chars
//   - no leading slash, no leading or embedded ".." segments
//   - each segment matches [A-Za-z0-9_-][A-Za-z0-9_.-]* (no leading dot)
//   - max depth 8
func ValidateFilePath(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		return "", errors.New("path is empty")
	}
	if len(p) > 200 {
		return "", errors.New("path too long (max 200)")
	}
	if strings.HasPrefix(p, "/") {
		return "", errors.New("path cannot be absolute")
	}
	cleaned := path.Clean(p)
	if cleaned != p {
		return "", errors.New("path must already be clean (no ./ or //)")
	}
	if cleaned == "." || strings.HasPrefix(cleaned, "../") || cleaned == ".." {
		return "", errors.New("path cannot escape the bundle root")
	}
	parts := strings.Split(cleaned, "/")
	if len(parts) > 8 {
		return "", errors.New("path too deep (max 8 segments)")
	}
	for _, seg := range parts {
		if !validPathSegment.MatchString(seg) {
			return "", errors.New("invalid path segment: " + seg)
		}
	}
	return cleaned, nil
}

// ListSkillFiles returns all files (without content) for a skill, sorted by
// path so directories cluster together.
func (s *Store) ListSkillFiles(ns, name string) ([]model.SkillFile, error) {
	rows, err := s.DB.Query(`SELECT path, size, updated_at, updated_by
		FROM skill_files WHERE ns = ? AND skill_name = ? ORDER BY path`, ns, name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.SkillFile
	for rows.Next() {
		var f model.SkillFile
		if err := rows.Scan(&f.Path, &f.Size, &f.UpdatedAt, &f.UpdatedBy); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// GetSkillFile fetches a single file with content. Returns (nil, nil) when not
// found so the caller can return 404.
func (s *Store) GetSkillFile(ns, name, p string) (*model.SkillFile, error) {
	row := s.DB.QueryRow(`SELECT path, content, size, updated_at, updated_by
		FROM skill_files WHERE ns = ? AND skill_name = ? AND path = ?`, ns, name, p)
	var f model.SkillFile
	if err := row.Scan(&f.Path, &f.Content, &f.Size, &f.UpdatedAt, &f.UpdatedBy); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &f, nil
}

// PutSkillFile inserts or replaces a file. Returns the row as it now exists.
func (s *Store) PutSkillFile(ns, name, p, content, updatedBy string) (*model.SkillFile, error) {
	if len(content) > MaxFileBytes {
		return nil, errors.New("file too large (max 1 MiB)")
	}
	if _, err := s.DB.Exec(`
		INSERT INTO skill_files(ns, skill_name, path, content, size, updated_at, updated_by)
		VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
		ON CONFLICT(ns, skill_name, path) DO UPDATE SET
			content    = excluded.content,
			size       = excluded.size,
			updated_at = CURRENT_TIMESTAMP,
			updated_by = excluded.updated_by`,
		ns, name, p, content, len(content), updatedBy); err != nil {
		return nil, err
	}
	return s.GetSkillFile(ns, name, p)
}

// DeleteSkillFile removes a file. Returns true if a row was actually removed.
func (s *Store) DeleteSkillFile(ns, name, p string) (bool, error) {
	res, err := s.DB.Exec(`DELETE FROM skill_files WHERE ns = ? AND skill_name = ? AND path = ?`, ns, name, p)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// SeedDefaultFiles bootstraps a freshly-created skill with a couple of starter
// files so the editor has something to render. No-op if the skill already has
// any files.
func (s *Store) SeedDefaultFiles(ns, name, description, author string) error {
	var existing int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM skill_files WHERE ns = ? AND skill_name = ?`, ns, name).Scan(&existing); err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}
	skillYaml := buildSkillYaml(ns, name, description)
	readme := buildReadme(name, description)
	if _, err := s.PutSkillFile(ns, name, "skill.yaml", skillYaml, author); err != nil {
		return err
	}
	if _, err := s.PutSkillFile(ns, name, "README.md", readme, author); err != nil {
		return err
	}
	return nil
}

func buildSkillYaml(ns, name, description string) string {
	return "name: " + name + "\nversion: \"0.1.0\"\nnamespace: " + ns + "\nclassification: L2\n\ndescription: |\n  " +
		strings.ReplaceAll(description, "\n", "\n  ") + "\n\nruntime:\n  image: \"alpine:3.19\"\n  timeout: 60s\n  memory: \"512Mi\"\n\ntags: []\n\ninputs: []\n"
}

func buildReadme(name, description string) string {
	return "# " + name + "\n\n" + description + "\n\n## 用法\n\n```bash\nskillhub run " + name + "\n```\n\n## 待补充\n\n- 详细的输入/输出说明\n- 失败模式与回退策略\n"
}
